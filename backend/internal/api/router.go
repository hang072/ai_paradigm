package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/embedding"
	"paradigm_eino_backend/internal/llm"
	"paradigm_eino_backend/internal/planner"
	"paradigm_eino_backend/internal/pubmed"
	"paradigm_eino_backend/internal/store"
	"paradigm_eino_backend/internal/store/sqlite"
)

// Deps 收拢所有 handler 依赖的 store 与 executor。
type Deps struct {
	Agents           store.Store[*domain.AgentDef]
	Nodes            store.Store[*domain.NodeDef]
	Templates        store.Store[*domain.WorkflowTemplate]
	TemplateVersions *sqlite.TemplateVersions // 阶段 2.4 模板版本历史
	Skills           store.Store[*domain.SkillDef]
	Knowledge        store.Store[*domain.KnowledgeBase]
	KBUploads        *sqlite.KbUploads        // 阶段 5 KB 文档上传二进制
	UploadSessions   *sqlite.UploadSessions   // 阶段 5 续 2 分片上传 session
	DocStructures    *sqlite.DocStructures    // 阶段 5 续 5 文档结构化 sidecar
	Tasks            TasksDeps
	LLMConfigMgr     *llm.ConfigManager
	Chat             *sqlite.Chat     // 会话持久化
	Settings         *sqlite.Settings // KV 设置持久化
	Pubmed           *pubmed.Client   // PubMed 文献检索(可为 nil,未配置 PUBMED_EMAIL 时)
	Planner          *planner.Planner // 阶段 3.3 动态 Planner

	// 阶段 5 续 3:向量检索(embedding package)
	Embedder    embedding.Embedder
	Milvus      *embedding.MilvusClient
	EmbedJobQ   *embedding.JobQueue
}

// 阶段 5 续 3:embedder / milvus / jobq 是 milvus 启动时绑定的, 用 package-level
// vars 供 handler 直接拿(避免给每个 chat 相关函数都透传 3 个参数)。
// 阶段 5 续 5 P84:kbUploads / docStructures 同样走 package-level, 单 doc 删除
// handler 需要直接拿(原 deps 在 router.go 闭包里, handler 拿不到)。
var (
	pkgEmbedder     embedding.Embedder
	pkgMilvusCli    *embedding.MilvusClient
	pkgEmbedJobQ    *embedding.JobQueue
	pkgKbUploads    *sqlite.KbUploads
	pkgDocStructures *sqlite.DocStructures
)

// InitEmbedding 在 main.go 启动时调一次。
// 后续 handler 内的 search_kb / reembed 都通过 pkgEmbedder / pkgMilvusCli / pkgEmbedJobQ 拿。
func InitEmbedding(emb embedding.Embedder, m *embedding.MilvusClient, jq *embedding.JobQueue) {
	pkgEmbedder = emb
	pkgMilvusCli = m
	pkgEmbedJobQ = jq
}

// InitKBStores 阶段 5 续 5 P84: 把 KB BLOB / sidecar store 注入到 package-level,
// 单 doc delete handler 直接拿(避免闭包陷阱)。
func InitKBStores(uploads *sqlite.KbUploads, ds *sqlite.DocStructures) {
	pkgKbUploads = uploads
	pkgDocStructures = ds
}

// NewRouter 组装 chi 路由。
//
// 路由顺序、路径与 frontend/src/api/mock/index.ts 保持一致。
func NewRouter(deps Deps) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// CORS:前端 dev server 通常是 5173,允许所有 origin 简化联调。
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "Authorization", "Accept"},
		ExposedHeaders:   []string{},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	// 健康检查
	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Route("/api", func(r chi.Router) {
		mountAgents(r, deps.Agents)
		mountNodes(r, deps.Nodes)
		mountTemplates(r, deps.Templates, deps.TemplateVersions)
		mountSkills(r, deps.Skills)
		if deps.Knowledge != nil {
			mountKnowledge(r, deps.Knowledge, deps.KBUploads)
			// KB 文档上传/下载子路由。必须在 mountKnowledge 之后,自身内部
			// /upload 与 /{docId}/blob 是更具体的字面段,排在 /{docId} 之前。
			if deps.KBUploads != nil {
				mountKBUploads(r, deps.Knowledge, deps.KBUploads, deps.DocStructures)
				// 阶段 5 续 2:分片上传 session 路由(必须在 /upload 之前,
				// chi 按注册顺序匹配,/upload/sessions 字面段更具体)。
				if deps.UploadSessions != nil {
					mountUploadSessionRoutes(r, deps.Knowledge, deps.KBUploads, deps.UploadSessions)
				}
			}
			// 阶段 5 续 5: 文档结构化 sidecar 读端点
			if deps.DocStructures != nil {
				r.Get("/kb/docs/{docId}/structure", handleGetDocStructure(deps.DocStructures))
			}
			// 阶段 5 续 3:embedding 重新向量化路由(必须在 deps.EmbedJobQ 不为 nil 时挂)
			if deps.EmbedJobQ != nil {
				mountReembedRoutes(r, deps.Knowledge, deps.EmbedJobQ)
			}
		}
		mountChat(r, deps.Agents, deps.Nodes, deps.Templates, deps.Skills, deps.Knowledge, deps.LLMConfigMgr, deps.Pubmed)
		if deps.Planner != nil {
			mountPlanner(r, deps.Planner)
		}
		if deps.Chat != nil {
			mountChatSessions(r, deps.Chat)
		}
		mountSettings(r, deps.LLMConfigMgr, deps.Settings)
		if deps.Tasks.Executor != nil {
			mountTasks(r, deps.Tasks)
		}
	})

	r.NotFound(func(w http.ResponseWriter, req *http.Request) {
		respondErr(w, http.StatusNotFound, "路由未实现: "+req.Method+" "+req.URL.Path)
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, req *http.Request) {
		respondErr(w, http.StatusMethodNotAllowed, "方法不允许: "+req.Method+" "+req.URL.Path)
	})

	return r
}
