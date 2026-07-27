# CardKey — Agent / 开发者指南

面向人类开发者与 AI Agent 的项目说明：架构、规范、本地开发、Git 推送、发版与服务器更新。

远程仓库：`https://github.com/hkx1997/CardKey`  
主分支：`main`  
当前版本见根目录 `VERSION`。

---

## 1. 项目是什么

自托管 **卡密兑换平台**：

| 端 | 路径 | 说明 |
|----|------|------|
| 公开兑换 | `/` | 选类别、兑码、批量、ZIP 导出 |
| 管理后台 | `/admin` | 类别/卡密/批次/密钥/设置/审计/更新 |
| 公开 API 文档 | `/docs` | 兑换侧接口 |
| 管理 API 文档 | `/admin/api-docs` | 登录后可见完整管理接口 |
| HTTP API | `/api/v1/*` | 统一 JSON 信封 |

栈：

| 层 | 技术 |
|----|------|
| 前端 | React 19 · Vite · Tailwind · TanStack Query · Zod · pnpm |
| 后端 | Go 1.22+ · chi · pgx · Redis · JWT |
| 数据 | PostgreSQL 16 · Redis 7 |
| 部署 | Docker Compose · 可选 Caddy/Nginx HTTPS |

---

## 2. 仓库结构

```
CardKey/
├── AGENTS.md                 # 本文件
├── VERSION                   # 语义化版本号（发版唯一来源）
├── docker-compose.yml        # name: cardkey；固定卷名
├── Dockerfile                # 多阶段：前端 build + Go 二进制
├── .env.example
├── backend/
│   ├── cmd/cardkey/          # 入口 main
│   ├── internal/
│   │   ├── app/              # 业务逻辑（领域用例）
│   │   ├── handler/          # HTTP 入参/出参
│   │   ├── middleware/       # 鉴权、CSRF、日志、限流相关
│   │   ├── server/           # 路由装配
│   │   ├── domain/           # 模型 DTO
│   │   ├── db/               # 连接与 migrate
│   │   ├── config/           # 环境变量
│   │   ├── crypto/           # 密码、API Key、卡密 AES-GCM
│   │   └── ...
│   └── migrations/           # 按文件名排序的 SQL（001_, 002_…）
├── frontend/
│   └── src/
│       ├── app/              # 路由、布局、Providers
│       ├── features/         # 按业务页拆分
│       ├── entities/         # 共享类型
│       ├── components/ui/    # 基础 UI
│       └── shared/           # api / hooks / lib / theme
├── deploy/                   # 安装、HTTPS、DATA_SAFETY
├── scripts/
│   ├── release.sh            # 正式发版（tag + Linux 资产 + GitHub Release）
│   ├── upgrade.sh            # 服务器安全升级（只重建 cardkey）
│   └── recover-volume.sh     # 挂错空卷时找回旧 Postgres 数据
├── DESIGN.md / REQUIREMENTS.md / TASKS.md
└── README.md / README_EN.md
```

**分层约定（后端）**

```
HTTP → handler → app（业务）→ pgx / redis
         ↑
    middleware（鉴权、CSRF、日志）
```

- 业务逻辑写在 `internal/app`，不要堆在 handler。
- 错误用 `internal/pkg/apperr`，响应用 `internal/pkg/response`（`success` + `data` / `error`）。
- 新表/改列：新增 `backend/migrations/00N_xxx.sql`，**禁止**改写已发布的旧迁移文件内容（新装环境靠 001 的现行定义即可同步）。
- **在线更新契约（强制）**：迁移 SQL 经 `backend/migrations/embed.go` 的 `//go:embed *.sql` 打进二进制；一键更新只换 exe 后，进程重启会 `MigrateFS(migrations.FS)` 自动应用。发版检查清单必须包含新迁移文件；勿依赖容器内磁盘 `/app/migrations` 是否最新。

**分层约定（前端）**

```
features/*-page  →  shared/hooks  →  shared/api (mock | http)
```

- `VITE_API_MODE=mock`：纯前端演示（`shared/api/mock`）。
- 生产/联调：`http` 客户端，Cookie 会话；路径前缀 `/api/v1`。
- 类型以 `entities/types.ts` 为准；表单校验用 Zod（`shared/lib/schemas.ts`）。
- 管理端导航：`shared/config/admin-nav.ts`。

---

## 3. 运行时架构

```
浏览器
  ├─ SPA（Go 静态托管 frontend/dist）
  └─ API /api/v1
         │
    cardkey 容器/进程
         ├─ PostgreSQL（卡密、类别、管理员、审计…）
         └─ Redis（限流、JWT 吊销等）
```

### 鉴权

| 场景 | 方式 |
|------|------|
| 浏览器管理端 | Cookie `cardkey_token`（JWT） |
| 脚本调管理 API | `Authorization: Bearer <API_Key>`，scope 需含 **`admin:api`** |
| 兑换 API | 可选/强制 Bearer，scope **`redeem:api`**（系统固定兑换密钥仅此权限） |
| CSRF | 带 Cookie 的写操作校验 Origin/Referer；纯 Bearer 脚本跳过 |

`RequireAdmin` 优先级：**Authorization Bearer** 优先于 Cookie；JWT 失败会回退尝试 API Key（避免 Key 被误报「会话过期」）。

### 敏感数据

- 卡密内容：AES-GCM，密钥来自 `CONTENT_KEY`（64 hex）；类型 text/txt/json/account 与 image/zip/pdf/file（≤5MB，二进制以 base64 下发并可下载）。
- API Key：仅存 hash；创建/轮换时返回一次明文。
- 演示数据：**仅**安装向导显式勾选时写入；启动 Bootstrap **不会**自动灌 VIP/CDK。

### Docker 卷（数据安全）

| 逻辑卷 | 默认外部名 |
|--------|------------|
| postgres_data | `cardkey_postgres_data` |
| cardkey_data | `cardkey_app_data` |
| redis_data | `cardkey_redis_data` |

可用 `.env` 的 `POSTGRES_VOLUME_NAME` 等覆盖以挂接旧数据。  
**禁止** `docker compose down -v` / `docker volume prune`。详见 `deploy/DATA_SAFETY.md`。

---

## 4. 开发规范

### 4.1 通用

- 改动聚焦需求，避免无关重构与大范围格式化。
- 用户可见文案优先中文；代码标识符英文。
- 不提交密钥、`.env`、真实卡密、本机 `cookies.txt` 等。
- 文档与行为不一致时，以代码为准，并同步改文档。

### 4.2 后端

```bash
cd backend
go build ./cmd/cardkey
go test ./...
```

- 新增路由：`server.go` 注册 + `handler` + `app`。
- 管理写操作应走审计（`App.Audit`）并带 actor/ip。
- 生产配置：`JWT_SECRET`、`CONTENT_KEY` 等由 `config.ValidateProduction` 约束，勿放宽成弱默认值。

### 4.3 前端

```bash
cd frontend
pnpm install
pnpm dev          # Mock 或代理视 env
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

- 新页面：放 `features/<name>/`，路由挂 `app/router.tsx`，需要侧栏则改 `admin-nav.ts`。
- API 列表文档：同步改 `features/docs/api-endpoints.ts`（及必要时 `api-docs-content.tsx`）。
- UI：复用 `components/ui` 与 `shared/components`；Toast 用现有 `api-toast` 模式。

### 4.4 提交信息

简洁完整句，说明**为什么**，例如：

```
fix: accept admin:api Bearer keys on admin routes
feat: one-click linux binary update for docker
docs: clarify volume recovery after false reset
```

可用 Conventional Commits：`feat:` / `fix:` / `chore:` / `docs:`。

### 4.5 Windows 注意

- 仓库脚本为 bash（`scripts/*.sh`、`deploy/*.sh`），用 **Git Bash** 或 WSL。
- 本机 shell 若吃掉引号，commit message 可用 `git commit -F msg.txt`。
- `go` / `gh` 路径以本机安装为准；发版优先用 Git Bash 跑 `scripts/release.sh`。

---

## 5. 本地开发流程

### 5.1 仅前端（Mock）

```bash
cd frontend
pnpm install
pnpm dev
```

### 5.2 全栈 Docker

```bash
cp .env.example .env   # 填 JWT_SECRET、CONTENT_KEY、POSTGRES_PASSWORD
docker compose up -d --build
# 兑换: http://localhost:18080/
# 管理: http://localhost:18080/admin
```

### 5.3 后端本机 + 外部 PG/Redis

```bash
# 配置 DATABASE_URL / REDIS_URL / JWT_SECRET / CONTENT_KEY
cd backend
go run ./cmd/cardkey
```

迁移在启动时自动执行 `backend/migrations/*.sql`。

---

## 6. Git：提交与推送远程

### 6.1 日常推送

```bash
git status
git add <相关文件>
git commit -m "简要说明动机与改动"
git push origin main
```

- 默认远程：`origin` → `https://github.com/hkx1997/CardKey.git`
- 推送前建议：`go test ./...`（backend）、`pnpm test` / `tsc`（frontend）
- **不要** force-push `main`，除非明确协调历史重写
- 发版 tag 一旦公开，勿改写已发布 tag 指向

### 6.2 建议推送前检查清单

- [ ] 无 `.env` / 密钥 / 大体积无关产物
- [ ] 迁移文件仅追加
- [ ] API 行为变更已改文档端点列表
- [ ] 涉及 Docker 卷/升级的改动已对照 `deploy/DATA_SAFETY.md`

### 6.3 分支策略（当前实践）

- 主开发与发布均在 **`main`**
- 版本以 **Git tag** `vX.Y.Z` + GitHub Release 为准
- 可选 feature 分支：`feature/xxx` → PR / merge 进 `main` 后再发版

---

## 7. 发版（维护者推送到远程 Release）

正式发版会：写入/读取 `VERSION` → 提交（若有）→ 构建 **linux-amd64 / linux-arm64** → 打 tag → `gh release create` 上传二进制。

### 7.1 前置

- 工作区干净（或仅允许改 `VERSION`，由脚本处理）
- 已安装：`go`、`git`、`gh`（已登录有 repo 权限）
- Git Bash / Linux / macOS

### 7.2 一键发版

```bash
# 使用 VERSION 文件中的版本
bash scripts/release.sh

# 或指定版本（会写回 VERSION）
bash scripts/release.sh 0.1.15

# 只看将要构建的内容
bash scripts/release.sh --dry-run
```

脚本要点：

1. 校验 tag 不重复  
2. `CGO_ENABLED=0` 交叉编译 `cardkey-linux-amd64` / `cardkey-linux-arm64`  
3. `git push origin main` + `git push origin vX.Y.Z`  
4. 创建 GitHub Release，附带上述二进制与校验信息  

**不要**再发 Windows/macOS 包作为 Docker 一键更新依赖；在线更新只认 Linux 资产。

### 7.3 发版后验证

- Release 页：`https://github.com/hkx1997/CardKey/releases/tag/vX.Y.Z`
- 资产齐全：`cardkey-linux-amd64`、`cardkey-linux-arm64`
- 管理端「检测更新」能看到新版本（可配置 `UPDATE_GITHUB_TOKEN` 降低 API 限流）

---

## 8. 服务器如何更新（部署侧）

### 8.1 推荐：只重建应用（不动数据库）

```bash
cd /path/to/CardKey   # 已有 .env 的部署目录
bash scripts/upgrade.sh
# 或固定版本：
bash scripts/upgrade.sh v0.1.14
```

等价于：

```bash
docker compose up -d --no-recreate postgres redis
docker compose build cardkey
docker compose up -d --no-deps cardkey
```

### 8.2 管理端一键更新（Docker 模式）

后台 → 版本信息 → **检测更新** → **一键更新**：

- 下载当前架构的 `cardkey-linux-*` Release 资产（**内嵌全部 `*.sql` 迁移**）  
- 替换进程二进制并退出，由 `restart: unless-stopped` 拉起  
- **启动时自动跑未应用迁移**（幂等；失败则进程起不来，便于从日志排查）  
- **不**执行 `compose down -v`，不删 Postgres 卷  

`.env` 中 `UPDATE_BINARY_PATH` / `UPDATE_RELEASES_DIR` **请留空**（自动用 `os.Executable()`）。

### 8.3 像「数据被重置」时

多数是 **挂到了新空卷**，旧数据仍在旧 volume：

```bash
docker volume ls | grep -iE 'cardkey|postgres'
bash scripts/recover-volume.sh
```

切勿：`docker compose down -v`、`docker volume rm`、`docker system prune --volumes`。

### 8.4 备份

```bash
docker compose exec -T postgres \
  pg_dump -U cardkey cardkey > backup-$(date +%F).sql
```

---

## 9. API 与响应约定

统一信封：

```json
{ "success": true, "data": { } }
```

```json
{ "success": false, "error": { "code": "...", "message": "..." } }
```

常用路径（前缀默认 `/api/v1`）：

| 方法 | 路径 | 鉴权 |
|------|------|------|
| GET | `/public/config` | 无 |
| POST | `/public/redeem` | 可选/强制 Key |
| POST | `/public/setup` | 仅 admins 为空 |
| POST | `/admin/auth/login` | 无 |
| GET | `/admin/categories` 等 | JWT 或 `admin:api` |
| GET | `/healthz` `/readyz` | 无 |
| GET | `/metrics` | `METRICS_TOKEN`（生产建议设） |

完整列表维护在前端 `features/docs/api-endpoints.ts`。

---

## 10. 给 AI Agent 的硬约束

1. **数据安全优先**：不写/不建议会删卷的命令；升级只用 `upgrade.sh` 或 `up -d --no-deps cardkey`。  
2. **演示数据**：禁止在 `Bootstrap` 里自动 `seedDemo`；仅 setup 显式开关。  
3. **鉴权**：管理 API 变更须同时考虑 Cookie JWT 与 `admin:api` Bearer。  
4. **发版**：改功能后若需用户可升级，应走 `scripts/release.sh` 产出 Linux 资产，勿只打无资产的 tag。  
4b. **迁移随更新**：任何 schema 变更必须新增 `backend/migrations/00N_*.sql` 并随 `release.sh` 编进二进制；在线更新不单独下发 SQL 文件。  
5. **范围**：不擅自改无关模块；不主动扩大需求；密钥永不写死进仓库。  
6. **文档**：架构/升级行为变更时同步 `AGENTS.md`、`README.md`、`deploy/DATA_SAFETY.md` 中相关段落。  

---

## 11. 相关文档索引

| 文档 | 用途 |
|------|------|
| `README.md` | 用户向安装与功能说明 |
| `DESIGN.md` | 详细设计 |
| `REQUIREMENTS.md` | 需求 |
| `deploy/DATA_SAFETY.md` | 卷与防误删 |
| `deploy/docker-deploy.sh` | 一键安装 |
| `scripts/release.sh` | 发版 |
| `scripts/upgrade.sh` | 安全升级 |
| `scripts/recover-volume.sh` | 找回旧卷 |

---

*维护：与代码行为冲突时以代码为准，并更新本文件。*
