// Package main 是 paradigm_eino 后端服务的入口。
//
// S1:装载 fixtures 到内存 store,4 套资源 (agents / nodes / templates / skills) 的 REST CRUD。
// S2a:加入 Tasks 状态机 (Eino compose.Graph + HITL), mock 内容 (不引 LLM 依赖)。
// S2b:引入 llm.Provider, 5 个 compute 节点用 LLM 生成, 未配置 LLM_API_KEY 时降级 mock。
// S3:换 SQLite 持久化 (backend/data/app.db), 聊天/设置/CRUD/任务全部落库, 支持跨端口/重启保留。
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

import (
	"paradigm_eino_backend/internal/api"
	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/engine"
	"paradigm_eino_backend/internal/fixtures"
	"paradigm_eino_backend/internal/llm"
	"paradigm_eino_backend/internal/pubmed"
	"paradigm_eino_backend/internal/store"
	sqlitestore "paradigm_eino_backend/internal/store/sqlite"
)

func main() {
	// 0. 初始化日志:同时输出到控制台和文件
	initLog()

	// 0.1. 加载 .env (仅当环境变量当前为空)
	if err := llm.LoadDotEnv("backend/.env"); err != nil {
		log.Printf("[warn] load backend/.env: %v", err)
	}
	if err := llm.LoadDotEnv(".env"); err != nil {
		log.Printf("[warn] load .env: %v", err)
	}

	// 1. 打开 SQLite (自动跑 migrations)
	dbPath := os.Getenv("PARADIGM_DB_PATH")
	if dbPath == "" {
		dbPath = "data/app.db"
	}
	db, err := sqlitestore.Open(dbPath)
	if err != nil {
		log.Fatalf("open sqlite %s: %v", dbPath, err)
	}
	defer db.Close()

	// 2. CRUD store (SQLite), 装 fixtures (builtin=true 走 UPSERT, 用户数据不受影响)
	agentStore := sqlitestore.NewEntities[*domain.AgentDef](db, "agent", domain.IDPrefixAgent,
		func() *domain.AgentDef { return &domain.AgentDef{} })
	nodeStore := sqlitestore.NewEntities[*domain.NodeDef](db, "node", domain.IDPrefixNode,
		func() *domain.NodeDef { return &domain.NodeDef{} })
	templateStore := sqlitestore.NewEntities[*domain.WorkflowTemplate](db, "template", domain.IDPrefixTemplate,
		func() *domain.WorkflowTemplate { return &domain.WorkflowTemplate{} })
	skillStore := sqlitestore.NewEntities[*domain.SkillDef](db, "skill", domain.IDPrefixSkill,
		func() *domain.SkillDef { return &domain.SkillDef{} })
	kbStore := sqlitestore.NewEntities[*domain.KnowledgeBase](db, "kb", domain.IDPrefixKB,
		func() *domain.KnowledgeBase { return &domain.KnowledgeBase{} })

	for _, a := range fixtures.Agents() {
		agentStore.Seed(a)
	}
	for _, n := range fixtures.Nodes() {
		nodeStore.Seed(n)
	}
	for _, t := range fixtures.Templates() {
		templateStore.Seed(t)
	}
	for _, s := range fixtures.Skills() {
		skillStore.Seed(s)
	}
	for _, k := range fixtures.KnowledgeBases() {
		kbStore.Seed(k)
	}

	// 2.1 编译期断言:SQLite Entities 也满足 store.Store 接口。
	var _ store.Store[*domain.AgentDef] = agentStore

	// 3. Tasks store + Eino checkpoint store + Executor (都换成 SQLite)
	snapshotStore := sqlitestore.NewTaskSnapshots(db)
	checkpointStore := sqlitestore.NewCheckpoints(db)

	// demo 任务只在表空时种入 (避免每次启动都插入重复 demo)
	if shouldSeedDemoTasks(db) {
		tplFull, _ := templateStore.Get("tpl-full")
		for _, t := range fixtures.DemoTasks(tplFull) {
			snapshotStore.Create(t)
		}
		log.Printf("[fixtures] seeded 2 demo tasks (empty task_snapshots)")
	}

	// 4. LLM 配置管理
	llmConfigMgr := llm.NewConfigManager(context.Background())

	// 4.1 若 SQLite 存过前端偏好设置且里面有 activeConfig + apiKey, 启动时应用一次
	settingsStore := sqlitestore.NewSettings(db)
	applyPersistedLLMPrefs(llmConfigMgr, settingsStore)

	// 4.2 PubMed 文献检索客户端(需 PUBMED_EMAIL;未配置时 Available()=false,
	//      search_literature / verify_reference 与 enrich 会如实说明未启用,绝不伪造)。
	pubmedClient := pubmed.NewClient(pubmed.Config{})
	litSource := pubmed.HitSource{Client: pubmedClient}

	// 5. 编译 task graph + executor
	graph, err := engine.BuildTaskGraph(snapshotStore, checkpointStore, llmConfigMgr, agentStore, kbStore, litSource)
	if err != nil {
		log.Fatalf("compile task graph: %v", err)
	}
	executor := engine.NewExecutor(graph, snapshotStore, checkpointStore, templateStore)

	// 6. Chat store
	chatStore := sqlitestore.NewChat(db)

	// 7. 起 chi 路由
	deps := api.Deps{
		Agents:       agentStore,
		Nodes:        nodeStore,
		Templates:    templateStore,
		Skills:       skillStore,
		Knowledge:    kbStore,
		LLMConfigMgr: llmConfigMgr,
		Chat:         chatStore,
		Settings:     settingsStore,
		Pubmed:       pubmedClient,
		Tasks: api.TasksDeps{
			Executor: executor,
			Store:    snapshotStore,
		},
	}
	r := api.NewRouter(deps)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8001"
	}
	addr := "0.0.0.0:" + port

	log.Printf("paradigm_eino backend listening on http://%s", addr)
	log.Printf("  agents=%d nodes=%d templates=%d skills=%d kbs=%d tasks=%d",
		len(agentStore.List()), len(nodeStore.List()),
		len(templateStore.List()), len(skillStore.List()),
		len(kbStore.List()),
		len(snapshotStore.List()))
	log.Printf("  llm provider: %s (available=%v)", llmConfigMgr.Get().Name(), llmConfigMgr.Get().Available())
	log.Printf("  pubmed: available=%v (需 PUBMED_EMAIL)", pubmedClient.Available())
	log.Printf("  db: %s", dbPath)

	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}

// shouldSeedDemoTasks 返回 true 当且仅当 task_snapshots 表为空。
// 用户即使删光所有任务也算 "非空"; 只有全新数据库才种 demo。
func shouldSeedDemoTasks(db *sql.DB) bool {
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM task_snapshots`).Scan(&n); err != nil {
		log.Printf("[warn] count task_snapshots: %v", err)
		return false
	}
	return n == 0
}

// applyPersistedLLMPrefs 从 SQLite 里恢复前端保存过的激活模型配置。
//
// 前端 llm_prefs 是自由 JSON, 期望字段:
//
//	{
//	  activeConfigId: "config-xxx",
//	  modelConfigs: [{ id, provider, model, apiKey, baseURL, ... }, ...],
//	}
//
// 找到 activeConfigId 对应的那条, apiKey 非空则调用 ConfigManager.Update 应用。
func applyPersistedLLMPrefs(mgr *llm.ConfigManager, settings *sqlitestore.Settings) {
	raw, ok, err := settings.Get("llm_prefs")
	if err != nil {
		log.Printf("[llm] load llm_prefs failed: %v", err)
		return
	}
	if !ok || raw == "" || raw == "null" {
		return
	}

	// 用 map 通用解析, 不强绑前端字段名
	var prefs map[string]any
	if err := json.Unmarshal([]byte(raw), &prefs); err != nil {
		log.Printf("[llm] parse llm_prefs: %v", err)
		return
	}
	activeID, _ := prefs["activeConfigId"].(string)
	configs, _ := prefs["modelConfigs"].([]any)
	if activeID == "" || len(configs) == 0 {
		return
	}

	for _, c := range configs {
		cm, ok := c.(map[string]any)
		if !ok {
			continue
		}
		if cm["id"] != activeID {
			continue
		}
		cfg := llm.ModelConfig{
			Provider: stringOf(cm["provider"]),
			Model:    stringOf(cm["model"]),
			APIKey:   stringOf(cm["apiKey"]),
			BaseURL:  stringOf(cm["baseURL"]),
		}
		if cfg.APIKey == "" {
			return
		}
		if err := mgr.Update(context.Background(), cfg); err != nil {
			log.Printf("[llm] apply persisted config %s failed: %v", activeID, err)
			return
		}
		log.Printf("[llm] applied persisted config: %s (%s / %s)", activeID, cfg.Provider, cfg.Model)
		return
	}
}

func stringOf(v any) string {
	s, _ := v.(string)
	return s
}

// initLog 初始化日志:同时输出到控制台和 logs/ 目录下的日志文件。
func initLog() {
	logDir := "logs"
	if err := os.MkdirAll(logDir, 0755); err != nil {
		log.Printf("[warn] create log directory %s: %v", logDir, err)
		return
	}
	date := time.Now().Format("2006-01-02")
	logPath := filepath.Join(logDir, "paradigm-eino-"+date+".log")
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		log.Printf("[warn] open log file %s: %v", logPath, err)
		return
	}
	multiWriter := io.MultiWriter(os.Stderr, f)
	log.SetOutput(multiWriter)
	log.Printf("=== paradigm_eino server starting at %s ===", time.Now().Format("2006-01-02 15:04:05"))
	log.Printf("log file: %s", logPath)
}
