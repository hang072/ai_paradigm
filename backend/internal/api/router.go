package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"paradigm_eino_backend/internal/domain"
	"paradigm_eino_backend/internal/llm"
	"paradigm_eino_backend/internal/pubmed"
	"paradigm_eino_backend/internal/store"
	"paradigm_eino_backend/internal/store/sqlite"
)

// Deps 收拢所有 handler 依赖的 store 与 executor。
type Deps struct {
	Agents        store.Store[*domain.AgentDef]
	Nodes         store.Store[*domain.NodeDef]
	Templates     store.Store[*domain.WorkflowTemplate]
	Skills        store.Store[*domain.SkillDef]
	Knowledge     store.Store[*domain.KnowledgeBase]
	Tasks         TasksDeps
	LLMConfigMgr  *llm.ConfigManager
	Chat          *sqlite.Chat     // 会话持久化
	Settings      *sqlite.Settings // KV 设置持久化
	Pubmed        *pubmed.Client   // PubMed 文献检索(可为 nil,未配置 PUBMED_EMAIL 时)
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
		mountTemplates(r, deps.Templates)
		mountSkills(r, deps.Skills)
		if deps.Knowledge != nil {
			mountKnowledge(r, deps.Knowledge)
		}
		mountChat(r, deps.Agents, deps.Nodes, deps.Templates, deps.Skills, deps.Knowledge, deps.LLMConfigMgr, deps.Pubmed)
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
