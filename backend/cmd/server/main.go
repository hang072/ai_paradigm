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
	"paradigm_eino_backend/internal/embedding"
	"paradigm_eino_backend/internal/engine"
	"paradigm_eino_backend/internal/fixtures"
	"paradigm_eino_backend/internal/llm"
	"paradigm_eino_backend/internal/parser"
	"paradigm_eino_backend/internal/planner"
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
	// 阶段 2.4:模板版本历史 store,模板 PUT 时建新行
	templateVersions := sqlitestore.NewTemplateVersions(db)
	skillStore := sqlitestore.NewEntities[*domain.SkillDef](db, "skill", domain.IDPrefixSkill,
		func() *domain.SkillDef { return &domain.SkillDef{} })
	kbStore := sqlitestore.NewEntities[*domain.KnowledgeBase](db, "kb", domain.IDPrefixKB,
		func() *domain.KnowledgeBase { return &domain.KnowledgeBase{} })

	// 阶段 5:KB 文档上传 BLOB 存储
	kbUploads := sqlitestore.NewKbUploads(db)
	// 阶段 5 续 2:分片上传 session 存储 + 24h TTL 后台 sweeper
	uploadSessions := sqlitestore.NewUploadSessions(db)
	go runUploadSessionSweeper(uploadSessions)
	// 阶段 5 续 5:文档结构化抽取 sidecar
	docStructures := sqlitestore.NewDocStructures(db)

	// 阶段 5 续 3:Embedding + 独立 Milvus(都是 hard dep,任一失败 → server 启动失败)
	// 走 docker-compose 起的 milvus-standalone,默认 localhost:19530
	milvusAddress := os.Getenv("MILVUS_ADDRESS")
	if milvusAddress == "" {
		milvusAddress = "localhost:19530"
	}
	embedder, err := embedding.NewOpenAICompatEmbedderFromEnv()
	if err != nil {
		log.Fatalf("init embedding: %v", err)
	}
	// 阶段 5 续 4: VLM OCR (Qwen-VL) — PDF 上传时抽真实文本(ledongthuc 中文 PDF 抽不到)
	// 阶段 5 续 5 P80: PDF 渲染改用纯 Go pdfview (built-in), 不再依赖 Poppler / pdftoppm。
	// soft-dep: 没 LLM_VISION_MODEL 时,parser 自动 fallback 到 ledongthuc(乱码)。
	if ok, p, msg := parser.CheckPdfview(); ok {
		log.Printf("pdf render: %s", p)
	} else {
		log.Printf("[WARN] pdf render: %s", msg)
	}
	visionOCR, err := embedding.NewQwenVLOpenAIOCRFromEnv()
	if err != nil {
		log.Printf("[main] vision OCR not available (%v), PDFs will use ledongthuc fallback", err)
		visionOCR = nil
	} else {
		parser.SetVisionOCR(visionOCR)
		log.Printf("vision ready: model=%s", visionOCR.Model())
	}
	milvusCli, err := embedding.NewMilvusClient(milvusAddress, embedder.Dim())
	if err != nil {
		log.Fatalf("init milvus: %v", err)
	}

	// 阶段 5 续 5 P91: PyMuPDF sidecar (PDF 抽文本/图/表)
	// hard-dep: 启动时 ping /health, 失败 → fatal (P91 全替决策, 不静默降级)
	pymupdfCli, err := embedding.NewPymupdfClientFromEnv()
	if err != nil {
		log.Fatalf("init pymupdf sidecar: %v (start uvicorn / docker compose up pymupdf-sidecar)", err)
	}
	parser.SetPymupdfClient(pymupdfCli)
	log.Printf("pymupdf sidecar ready: %s", pymupdfCli.BaseURL())
	defer milvusCli.Close()
	jobQ := embedding.NewJobQueue(embedder, milvusCli, kbStore, kbUploads, docStructures)
	jobQ.Start()
	defer jobQ.Stop()
	api.InitEmbedding(embedder, milvusCli, jobQ)
	// 阶段 5 续 5 P84: 单 doc delete handler 需要直接拿 pkgKbUploads /
	// pkgDocStructures, 走 package-level 注入(同 InitEmbedding 模式)。
	api.InitKBStores(kbUploads, docStructures)
	log.Printf("embedding ready: model=%s dim=%d", embedder.Model(), embedder.Dim())

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

	// 阶段 3.1.3:把 agent / KB / PubMed 注入 builtin 节点注册表,
	// 让 runGenericStep 走通用化路径(不依赖 apply*LLM 的硬编码分支)
	engine.SetBuiltinSources(agentStore, kbStore, litSource)

	// 阶段 4.6:提前装配 taskArtifacts(供 BuildTaskGraph 用)
	taskArtifacts := sqlitestore.NewTaskArtifacts(db)

	// 5. 编译 task graph + executor
	// 阶段 3:同时支持动态构图(Planner 输出 spec 走 BuildGraphFromSpec)与
	// 静态兜底(BuildTaskGraph, tpl-full / tpl-slide-simple / tpl-article-simple
	// 走它,因为老图含 review_branch 等精细逻辑)
	graph, err := engine.BuildTaskGraph(snapshotStore, checkpointStore, llmConfigMgr, agentStore, kbStore, litSource, taskArtifacts)
	if err != nil {
		log.Fatalf("compile task graph: %v", err)
	}
	dynamicDeps := &engine.DynamicGraphDeps{
		SnapshotStore:   snapshotStore,
		CheckPointStore: checkpointStore,
		ConfigMgr:       llmConfigMgr,
		AgentStore:      agentStore,
		KBStore:         kbStore,
		LitStore:        litSource,
		TaskArtifacts:   taskArtifacts,
	}
	executor := engine.NewExecutorWithDynamic(graph, snapshotStore, checkpointStore, templateStore, dynamicDeps)

	// 6. Chat store
	chatStore := sqlitestore.NewChat(db)

	// 6.1 Planner(阶段 3.3)
	plannerSvc := planner.New(llmConfigMgr, planner.Sources{
		Agents:    agentStore,
		Nodes:     nodeStore,
		Templates: templateStore,
	})

	// 7. 起 chi 路由
	deps := api.Deps{
		Agents:           agentStore,
		Nodes:            nodeStore,
		Templates:        templateStore,
		TemplateVersions: templateVersions,
		Skills:           skillStore,
		Knowledge:        kbStore,
		KBUploads:        kbUploads,
		UploadSessions:   uploadSessions,
		DocStructures:    docStructures, // 阶段 5 续 5
		EmbedJobQ:        jobQ, // 阶段 5 续 3: 传 nil → mountReembedRoutes 跳过 → /reembed 返 404
		LLMConfigMgr:     llmConfigMgr,
		Chat:             chatStore,
		Settings:         settingsStore,
		Pubmed:           pubmedClient,
		Planner:          plannerSvc,
		Tasks: api.TasksDeps{
			Executor:  executor,
			Store:     snapshotStore,
			Artifacts: taskArtifacts,
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

	// 阶段 5 续 2:用 http.Server 显式设超时。读 10 分钟覆盖 1.3 GiB 上传在慢
	// 网络上的极端情况;空闲 2 分钟自动释放。写也 10 分钟对齐,handler 里 ctx
	// 仍是更细的兜底(单 chunk 5 MiB + 60s 解析超时)。
	srv := &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 30 * time.Second,
		ReadTimeout:       10 * time.Minute,
		WriteTimeout:      10 * time.Minute,
		IdleTimeout:       2 * time.Minute,
	}
	if err := srv.ListenAndServe(); err != nil {
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

// runUploadSessionSweeper 后台 goroutine:每小时扫一次,把所有过期 session
// (state='open' 且 expires_at < now) 标 aborted 并清 chunks,释放 BLOB。
// 极端情况 session 可能在 25h 才被清(接受,见 plan "已知折中")。
func runUploadSessionSweeper(sessions *sqlitestore.UploadSessions) {
	t := time.NewTicker(1 * time.Hour)
	defer t.Stop()
	for range t.C {
		n, err := sessions.SweepExpired()
		if err != nil {
			log.Printf("[upload-sweeper] error: %v", err)
			continue
		}
		if n > 0 {
			log.Printf("[upload-sweeper] aborted %d expired sessions", n)
		}
	}
}
