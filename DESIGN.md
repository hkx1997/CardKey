# CardKey — 系统设计文档

| 项 | 内容 |
|---|---|
| 关联需求 | [REQUIREMENTS.md](./REQUIREMENTS.md) |
| 设计版本 | v1.2 |
| 更新日期 | 2026-07-27 |
| 状态 | ✅ 已确认（含类别 / 共享层 / 私有仓库） |

> 未特别指定的选项采用需求文档「推荐默认」。

---

## 1. 项目概述

CardKey 是自托管、高并发、高安全的卡密兑换平台：

- **兑换端**：公开、无登录；**先选类别**，再凭该类别下的唯一编码兑换
- **管理端**：登录后管理**类别**、卡密、批次、兑换记录、API Key、设置
- **API**：公开兑换（必传类别）+ 鉴权录入（必属类别）
- **部署**：Docker 本地开发；`curl | bash` 一键生产安装
- **源码托管**：**私有 GitHub 仓库**（不开源）；安装脚本与 CI 按私有仓鉴权方式分发

设计原则：**强封装、安全默认、兑换强一致、可水平扩展、类别完全隔离**。

### 1.1 开发铁律

| 铁律 | 说明 |
|---|---|
| **原型即产品** | 高保真前端 **不是可丢弃 demo**。目录、组件、路由、API 抽象、设计 token 从第一天起按生产标准建设；Mock 仅作为 `shared/api` 的可替换适配器，接通后端时删 Mock，不重写 UI。 |
| **零历史兼容** | 全项目 **不做** 旧模式 / 旧接口 / 旧配置 / 旧数据迁移兼容。任何演进直接采用当前最优方案，允许破坏性变更；不保留废弃字段、双写、feature flag 兼容层（除非当迭代明确需要的功能开关）。 |
| **始终最优** | 技术选型、并发模型、加密、封装边界以「当前最佳实践」为准，不为「以后兼容旧客户端」降级设计。 |
| **单一真源** | API 契约、领域模型、错误码只维护一套；前后端同步更新，不维护 v0/v1 双轨。 |
| **共享层优先** | 请求/响应信封、错误码、分页、鉴权上下文、UI  primitives、业务公共块等 **只实现一次**，业务层禁止复制粘贴分叉。 |
| **类别完全隔离** | 不同类别的卡密在编码空间、库存、兑换入口、统计维度上 **互不共享、互不混淆**；跨类别不可兑换。 |
| **私有仓库** | 默认 private；README/License 按私有项目维护，不假设公开 raw 免鉴权拉取（一键安装需 Token 或自建镜像）。 |
| **Docker 本地优先** | 高保真与正式开发共用 `docker-compose.yml` 骨架；当前 frontend 镜像，后续叠加 PG/Redis/后端服务，不另起两套部署。 |
| **双轨 API 密钥** | `redeem:api` 仅兑换；`admin:api` 全面管理；兑换端固定密钥只绑定 `redeem:api`。API 文档总开关 + 兑换端展示开关由设置控制。 |

---

## 2. 技术栈选择

### 2.1 后端

| 组件 | 选型 | 理由 |
|---|---|---|
| 语言 | Go 1.22+ | 高并发、部署简单、与 grok2api 生态一致 |
| HTTP | **chi** + 标准 `net/http` | 轻量、中间件清晰、无过度魔法，便于高度封装 |
| 配置 | envconfig / 环境变量 + YAML 可选 | 12-factor，Docker 友好 |
| DB 驱动 | **pgx/v5** + **sqlc**（或 squirrel） | 类型安全 SQL、性能优于重 ORM；事务可控 |
| 缓存/限流/锁 | **Redis 7** | 限流、会话黑名单、可选分布式锁 |
| 认证 | JWT (HS256) + 可选 refresh；API Key | 管理 UI 用 JWT；机器对接用 API Key |
| 密码 | bcrypt / argon2id | 管理员密码；API Key 仅存 hash |
| 加密 | AES-256-GCM | 卡密内容 at-rest |
| 日志 | slog (结构化 JSON) | 标准库、可观测 |
| 迁移 | golang-migrate | 版本化 schema |

> 若团队更熟 Gin，可替换路由层，**业务分层接口不变**。

### 2.2 前端

| 组件 | 选型 | 理由 |
|---|---|---|
| 框架 | React 19 + TypeScript | 对齐 grok2api |
| 构建 | Vite 8 | 快、生态成熟 |
| 样式 | Tailwind CSS 4 + shadcn/ui + Radix | 参考 grok2api 视觉与组件体系 |
| 状态/请求 | TanStack Query + 轻量 UI state | 服务端状态统一 |
| 表单 | React Hook Form + Zod | 校验与类型一体 |
| 路由 | React Router 7 | SPA：`/` 兑换、`/admin/*` 管理 |
| 主题 | next-themes 风格 dark/light | 深色优先 |
| 图标 | lucide-react | 与 shadcn 配套 |
| 包管理 | pnpm | 与 grok2api 一致 |

### 2.3 基础设施

| 组件 | 选型 |
|---|---|
| 数据库 | **PostgreSQL 16** |
| 缓存 | **Redis 7** |
| 反向代理（可选生产） | Caddy / Nginx / Traefik |
| 容器 | Docker multi-stage + Compose |
| 一键安装 | `deploy/install.sh` / `docker-deploy.sh`（对齐 sub2api） |

---

## 3. 整体架构

```
                    ┌─────────────────────────────────────────┐
                    │              Clients                     │
                    │  Browser(兑换/管理)  ·  第三方 API 调用   │
                    └────────────┬────────────┬───────────────┘
                                 │            │
                    ┌────────────▼────────────▼───────────────┐
                    │         CardKey App (Go 单进程)          │
                    │  ┌──────────┐  ┌─────────────────────┐  │
                    │  │ Static   │  │  HTTP API (chi)      │  │
                    │  │ SPA dist │  │  /api/v1/public/*    │  │
                    │  │          │  │  /api/v1/admin/*     │  │
                    │  └──────────┘  └──────────┬──────────┘  │
                    │                           │             │
                    │  Middleware: Recover · RequestID · CORS  │
                    │  · RateLimit · Auth · Audit · Security  │
                    │                           │             │
                    │  ┌────────────────────────▼──────────┐  │
                    │  │ Service Layer（领域服务）            │  │
                    │  │ Auth · Category · Card · Redeem ·  │  │
                    │  │ Batch · ApiKey · Settings · Stats  │  │
                    │  │ · Audit                            │  │
                    │  └────────────────────────┬──────────┘  │
                    │                           │             │
                    │  ┌────────────┐  ┌────────▼──────────┐  │
                    │  │ Crypto     │  │ Repository (pgx)  │  │
                    │  │ RateLimit  │  │                   │  │
                    │  │ CodeGen    │  └────────┬──────────┘  │
                    │  │ (按类别)    │           │             │
                    │  └────────────┘           │             │
                    └───────────────────────────┼─────────────┘
                                                │
                         ┌──────────────────────┼──────────────┐
                         ▼                      ▼              │
                   PostgreSQL                 Redis            │
                   (持久化)              (限流/黑名单/缓存)      │
```

**部署形态**：生产默认单容器 `cardkey` + 外部或 compose 内的 Postgres/Redis；Go **同源托管**前端 `dist`，单端口（默认 `8080`）。

---

## 4. 目录结构

```
CardKey/
├── REQUIREMENTS.md
├── DESIGN.md
├── TASKS.md
├── README.md
├── VERSION
├── Makefile
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── .gitignore
│
├── deploy/
│   ├── docker-deploy.sh            # 私有仓：需 GITHUB_TOKEN 或镜像仓库
│   ├── docker-compose.prod.yml
│   └── .env.example
│
├── backend/
│   ├── go.mod
│   ├── cmd/cardkey/main.go
│   ├── internal/
│   │   ├── config/
│   │   ├── domain/                 # 实体 + 领域错误（无 IO）
│   │   ├── repository/
│   │   ├── service/                # Category · Card · Redeem …
│   │   ├── handler/
│   │   ├── middleware/
│   │   ├── crypto/
│   │   ├── ratelimit/
│   │   ├── bootstrap/
│   │   ├── server/
│   │   └── pkg/                    # ★ 后端共享层（见 §4.1）
│   │       ├── response/           # 统一响应信封
│   │       ├── apperr/             # 错误码与 HTTP 映射
│   │       ├── pagination/         # 分页请求/响应
│   │       ├── validate/           # 绑定与校验
│   │       ├── requestid/
│   │       ├── ctxkey/             # 上下文键（admin/apiKey）
│   │       └── id/                 # UUID 等
│   └── migrations/
│
└── frontend/
    └── src/
        ├── app/
        ├── features/
        │   ├── redeem/
        │   ├── auth/
        │   ├── dashboard/
        │   ├── categories/         # ★ 类别管理
        │   ├── cards/
        │   ├── batches/
        │   ├── redeems/
        │   ├── api-keys/
        │   ├── settings/
        │   └── audit/
        ├── entities/               # 领域类型、queryKey、zod schema
        ├── components/ui/          # ★ 设计系统 primitives
        └── shared/                 # ★ 前端共享层（见 §4.2）
            ├── api/
            ├── auth/
            ├── config/
            ├── lib/
            └── components/         # 业务级公共块（非 primitive）
```

### 4.1 后端共享层（全面）

| 模块 | 职责 | 业务层禁止 |
|---|---|---|
| `pkg/response` | 统一成功/失败 JSON 信封；`OK(w, data)` / `Fail(w, err)` | 手写 `json.NewEncoder` 分叉结构 |
| `pkg/apperr` | 稳定错误码枚举、消息、默认 HTTP Status；`Wrap`/`Is` | 魔法字符串错误码、随意 HTTP 状态 |
| `pkg/pagination` | `page`/`page_size` 解析、上限钳制、`Page[T]` 响应 | 各接口自定分页字段名 |
| `pkg/validate` | 请求体绑定 + 字段校验（必填、长度、枚举） | Handler 内散落 if 校验 |
| `middleware` 链 | Recover、RequestID、AccessLog、CORS、SecurityHeaders、RateLimit、AuthJWT、AuthAPIKey、Audit | 路由内重复鉴权逻辑 |
| `domain` 枚举 | `CardStatus`、`CardType`、错误哨兵值 | 字符串裸奔 |
| `crypto` | 密码哈希、内容 AES-GCM、API Key 生成/哈希、编码生成（**按类别规则**） | 业务里直接调 rand/cipher |
| `ratelimit` | 统一 key 规范：`rl:redeem:ip:`、`rl:redeem:cat+code:` | 各接口自造 Redis key |
| 配置 `config` | 环境变量单一加载与校验 | 到处 `os.Getenv` |
| 日志 `slog` | 结构化 + 脱敏 helper | `fmt.Println` 打敏感信息 |

**统一响应信封（唯一契约）：**

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": { "request_id": "...", "page": 1, "page_size": 20, "total": 100 },
  "request_id": "..."
}
```

失败时 `success=false`，`error: { "code": "CARD_INVALID", "message": "..." }`，`data` 省略或 null。  
**禁止**另起 `code:0/1`、`errno`、裸数组根响应。

**统一错误码（扩展表，单一注册表）：**

| code | HTTP | 场景 |
|---|---|---|
| VALIDATION_ERROR | 400 | 参数/类别缺失 |
| UNAUTHORIZED | 401 | 未登录/Key 无效 |
| FORBIDDEN | 403 | 无权限 |
| NOT_FOUND | 404 | 资源不存在（管理端） |
| CATEGORY_INVALID | 400 | 类别不存在或已禁用（公开侧可并入 CARD_INVALID） |
| CATEGORY_DISABLED | 403 | 类别关闭 |
| CARD_INVALID | 404/403 | 公开兑换：不存在/禁用等统一 |
| CARD_USED | 409 | 已使用 |
| CARD_EXPIRED | 410 | 已过期 |
| RATE_LIMITED | 429 | 限流 |
| CONFLICT | 409 | 唯一约束等 |
| INTERNAL_ERROR | 500 | 内部错误 |

### 4.2 前端共享层（全面）

| 层级 | 路径 | 内容 |
|---|---|---|
| 设计系统 | `components/ui/*` | Button、Input、Select、Table、Dialog… **零业务** |
| 业务公共块 | `shared/components/*` | `PageHeader`、`EmptyState`、`DataToolbar`、`PaginationBar`、`CopyButton`、`ConfirmDialog`、`StatCard`、`CategorySelect` |
| API 门面 | `shared/api/client` | 唯一出口；mock/http 适配器 |
| 传输契约 | `shared/api/types` + `entities` | 与后端信封一致的 `ApiResponse<T>`、`ApiError`、分页类型 |
| HTTP 内核 | `shared/api/http` | credentials、错误抛出、request_id 透传 |
| 鉴权 | `shared/auth` | session 上下文、路由守卫 |
| 工具 | `shared/lib` | `cn`、日期、状态 Badge、类别编码展示 |
| 配置 | `shared/config` | `VITE_API_MODE` 等 |
| 领域 | `entities` | Card / Category / … 类型与 queryKey 工厂 |

**约定：** features 只组装 shared + ui；禁止 feature 之间互相 import 页面组件；禁止页面内私自 `fetch`。

### 4.3 分层纪律

- Handler 不写业务；Service 不依赖 `http.ResponseWriter`；Repository 不写业务规则
- 新接口必须复用 `response`/`apperr`/`pagination`，Code Review 拒绝分叉信封
- 新 UI 优先复用 `shared/components`，禁止复制整页表格脚手架

---

## 5. 数据模型

### 5.1 ER 概览

```
categories 1──* cards
categories 1──* batches
admins 1──* audit_logs
cards 1──0..1 redeem_records
api_keys
settings (KV)
```

**类别是卡密的根隔离边界**：所有卡密、批次、兑换记录逻辑上归属某一 `category`。

### 5.2 类别完全隔离规则

| 规则 | 说明 |
|---|---|
| 库存隔离 | 卡密行必须带 `category_id`，禁止 NULL |
| 编码空间隔离 | 唯一约束 `UNIQUE(category_id, code)`；**不同类别允许「字符串相同」但业务上禁止跨类兑换**——生成器仍按类别前缀保证视觉与碰撞空间分离 |
| 编码格式不一致 | **每个类别独立 `code_prefix` + 可选段规则**；生成的码必须以该前缀开头（例：`VIP-…`、`CDK-…`、`ACC-…`），用户侧可肉眼区分 |
| 兑换隔离 | 兑换 API **必须**传 `category`（slug 或 id）+ `code`；仅在该类别下查找；A 类码在 B 类入口永远失败 |
| 导入隔离 | 导入/创建必须指定类别；批次隶属类别 |
| 统计隔离 | 仪表盘可总览，也可按类别过滤 |
| 配置隔离 | 类别可独立：启用/禁用、排序、兑换页展示名、备注 |
| 不可迁移 | v1 不提供「改卡密所属类别」；需作废后在新类别重建（零兼容） |

### 5.3 表定义

#### `categories`

| 列 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| name | VARCHAR(64) | 展示名，如「会员卡」 |
| slug | VARCHAR(64) UNIQUE | API/URL 用，如 `vip` |
| code_prefix | VARCHAR(16) UNIQUE | 编码前缀，如 `VIP`；生成 `VIP-XXXX-…` |
| description | TEXT | |
| enabled | BOOL | 禁用后不可兑换、不出现在公开列表 |
| sort_order | INT | 兑换端排序 |
| created_at / updated_at | TIMESTAMPTZ | |

#### `admins`

| 列 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| username | VARCHAR(64) UNIQUE | |
| password_hash | TEXT | argon2id/bcrypt |
| must_change_password | BOOL | 首次登录强制改密 |
| created_at / updated_at | TIMESTAMPTZ | |
| last_login_at | TIMESTAMPTZ NULL | |

#### `batches`

| 列 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| category_id | UUID NOT NULL FK → categories | 批次隶属类别 |
| name | VARCHAR(128) | 批次名 |
| note | TEXT | |
| created_at | TIMESTAMPTZ | |
| created_by | UUID NULL → admins | |

#### `cards`

| 列 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| category_id | UUID NOT NULL FK → categories | **隔离根** |
| code | VARCHAR(64) NOT NULL | 兑换编码（含类别前缀） |
| content_enc | BYTEA NOT NULL | AES-GCM 密文 |
| content_nonce | BYTEA NOT NULL | |
| type | VARCHAR(32) | `text` \| `json` \| `account` |
| batch_id | UUID NULL FK | |
| status | VARCHAR(16) | `unused` \| `used` \| `disabled` \| `expired` |
| note | TEXT | 内部备注，不对用户展示 |
| expires_at | TIMESTAMPTZ NULL | |
| used_at | TIMESTAMPTZ NULL | |
| used_ip | INET NULL | |
| version | INT NOT NULL DEFAULT 1 | 乐观锁 |
| created_at / updated_at | TIMESTAMPTZ | |

**索引：**

- `UNIQUE(category_id, code)` — 类别内唯一
- `(category_id, status, created_at DESC)`
- `(batch_id)`
- `(used_at DESC)` 部分索引 WHERE status = 'used'

#### `redeem_records`

| 列 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| category_id | UUID NOT NULL FK | 冗余便于按类查询 |
| card_id | UUID UNIQUE FK | 一卡一成功记录 |
| code | VARCHAR(64) | 冗余便于查询 |
| ip | INET | |
| user_agent | TEXT | |
| created_at | TIMESTAMPTZ | |

> v1：**仅记录成功兑换** + 管理端可见；失败尝试走限流/日志，避免写爆库。可选 P2 再加失败表。

#### `api_keys`

| 列 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| name | VARCHAR(128) | |
| key_prefix | VARCHAR(16) | 展示用 `ck_live_xxxx` |
| key_hash | BYTEA UNIQUE | SHA-256(key) |
| scopes | TEXT[] | 如 `{cards:write,cards:read}` |
| rate_limit_rpm | INT NULL | |
| ip_allowlist | INET[] NULL | |
| expires_at | TIMESTAMPTZ NULL | |
| revoked_at | TIMESTAMPTZ NULL | |
| last_used_at | TIMESTAMPTZ NULL | |
| created_at | TIMESTAMPTZ | |
| created_by | UUID NULL | |

#### `settings`

| 列 | 类型 | 说明 |
|---|---|---|
| key | VARCHAR(64) PK | |
| value | JSONB | |
| updated_at | TIMESTAMPTZ | |

预设 key：`site_name`, `redeem_title`, `redeem_subtitle`, `rate_limit`, `captcha`, `export_include_content` 等。

#### `audit_logs`

| 列 | 类型 | 说明 |
|---|---|---|
| id | BIGSERIAL / UUID | |
| actor_type | VARCHAR(16) | `admin` \| `api_key` \| `system` |
| actor_id | UUID NULL | |
| action | VARCHAR(64) | `login`, `import`, `disable_card`, … |
| resource | VARCHAR(64) | |
| detail | JSONB | 脱敏后 |
| ip | INET | |
| created_at | TIMESTAMPTZ | |

### 5.3 卡密状态机

```
                 disable
    ┌──────────────────────────┐
    │                          ▼
 [unused] ──redeem──► [used]     [disabled]
    │                    ▲
    │ expire job         │ (不可从 used 回退)
    ▼                    │
 [expired] ──────────────┘ (不可再兑)
```

- `used` / `expired` / `disabled` 均不可兑换
- 兑换成功时：事务内 `UPDATE ... WHERE status='unused' AND version=?` 或 `status='unused'` 返回 1 行

---

## 6. 核心算法与业务逻辑

### 6.1 兑换编码生成（按类别 · 格式互不一致）

```
{CODE_PREFIX}-{SEG}-{SEG}-{SEG}-{SEG}
```

- `CODE_PREFIX` 来自 **该类别** 的 `code_prefix`（大写字母数字，2–8 位），**全局唯一**
- 每段 4 字符，字符集 `A-Z2-9`（去 0/O/1/I）；4 段 ≈ 80 bit 熵 + 前缀命名空间
- 示例：
  - 类别 VIP → `VIP-7K3M-9P2X-W4QH-R8NT`
  - 类别 激活码 → `CDK-A2B3-C4D5-E6F7-G8H9`
  - 类别 账号 → `ACC-…`
- 生成：`crypto/rand`；冲突（同类别）重试；`UNIQUE(category_id, code)` 兜底
- **禁止** 跨类别共用同一前缀、禁止全局单一 `CK-` 前缀（与「类别完全不一致」冲突）
- 校验：兑换时除查库外，可校验 code 是否匹配该类别 prefix（快速失败）

### 6.2 内容加解密

```
密钥: CONTENT_ENCRYPTION_KEY (32 bytes, base64 环境变量)
加密: nonce(12) || AES-GCM(plaintext)
库内: content_enc + content_nonce 分列（或合并 blob）
```

- 解密仅发生在：兑换成功返回、管理端「查看内容」授权操作、导出含内容时
- 密钥轮换：v1 单密钥；预留 `key_id` 字段二期

### 6.3 兑换事务（强一致 · 类别维度）

```
1. 解析 category（slug 或 id）→ 必须存在且 enabled
2. 规范化 code（trim、大写）；校验前缀 == category.code_prefix（可选严格模式）
3. 限流：IP + (category_id, code)
4. BEGIN
5. SELECT * FROM cards WHERE category_id=$cat AND code=$code FOR UPDATE
6. 校验 status / expires_at
7. 若已 used：allow_requery 则返回内容，否则 CARD_USED
8. 若 unused：UPDATE + INSERT redeem_records(category_id, …)
9. COMMIT → 解密 content 返回（含 category 信息）
```

**跨类攻击：** 用户拿 VIP 码去 CDK 类别兑 → 查无记录 → `CARD_INVALID`（不提示「类别不对」以防信息泄露，或产品可选提示）。

**并发：** 同行锁；仅一人成功。

### 6.4 批量导入

```
1. 解析 TXT/CSV/JSON → []ImportItem{content, type?, note?}
2. 校验条数上限（默认单次 ≤ 5000）、内容大小
3. 创建或绑定 batch
4. 批量生成 code，加密 content
5. COPY 或分批 INSERT（事务分片，每片 500）
6. 返回 { batch_id, total, items:[{code, id}] }  — 仅此响应含完整 code 列表
7. 写 audit_log
```

### 6.5 管理员 Bootstrap

```
启动时:
  if count(admins)==0:
    username = "admin" 或 "admin_"+random(4)
    password = crypto/rand 24 字符
    插入 admins(must_change_password=true)
    打印到 stdout（醒目框）
  不写明文密码到任何持久化文件
```

### 6.6 API Key

- 生成：`ck_live_` + 32 字节 hex
- 存储：`SHA-256(key)` + prefix 前 12 字符
- 鉴权：Bearer 比对 hash；检查 revoked / expires / IP / scope

---

## 7. API 设计

### 7.1 统一响应

**成功：**

```json
{
  "success": true,
  "data": { },
  "request_id": "..."
}
```

**失败：**

```json
{
  "success": false,
  "error": {
    "code": "CARD_USED",
    "message": "该卡密已兑换"
  },
  "request_id": "..."
}
```

### 7.2 错误码（节选）

| code | HTTP | 说明 |
|---|---|---|
| INVALID_CODE | 400 | 格式非法 |
| CARD_NOT_FOUND | 404 | 与「无效」可合并为同一对外文案防枚举 |
| CARD_USED | 409 | 已使用 |
| CARD_DISABLED | 403 | 已禁用 |
| CARD_EXPIRED | 410 | 已过期 |
| RATE_LIMITED | 429 | 限流 |
| UNAUTHORIZED | 401 | |
| FORBIDDEN | 403 | |
| VALIDATION_ERROR | 400 | |
| INTERNAL_ERROR | 500 | 不暴露细节 |

**防枚举策略（公开兑换）：**  
配置 `security.mask_card_errors=true`（默认）时，不存在/禁用/非法对外统一：`CARD_INVALID` + 「卡密无效或不可用」；仅 `CARD_USED` / `CARD_EXPIRED` 可区分（产品可选全统一）。  
**推荐默认：不存在与禁用统一；已用、过期单独提示（用户体验更好）。**

### 7.3 公开 API

| Method | Path | 说明 |
|---|---|---|
| GET | `/healthz` | 存活 |
| GET | `/readyz` | DB+Redis 就绪 |
| GET | `/api/v1/public/config` | 站点文案 + **已启用类别列表** |
| POST | `/api/v1/public/redeem` | 兑换（**必传 category + code**） |

**GET /api/v1/public/config**

```json
{
  "siteName": "CardKey",
  "redeemTitle": "卡密兑换",
  "redeemSubtitle": "请选择类别并输入兑换编码",
  "captchaEnabled": false,
  "categories": [
    { "slug": "vip", "name": "会员卡", "codePrefix": "VIP", "description": "会员权益" },
    { "slug": "cdk", "name": "激活码", "codePrefix": "CDK", "description": "" }
  ]
}
```

**POST /api/v1/public/redeem**

```json
// request — category 与 code 均为必填
{
  "category": "vip",
  "code": "VIP-7K3M-9P2X-W4QH-R8NT",
  "captcha_token": "optional"
}

// success data
{
  "status": "success",
  "category": "vip",
  "categoryName": "会员卡",
  "code": "VIP-7K3M-...",
  "type": "text",
  "content": "…",
  "redeemed_at": "2026-07-27T12:00:00Z"
}
```

### 7.4 管理 API（JWT Cookie/Bearer）

前缀：`/api/v1/admin`

| Method | Path | 说明 |
|---|---|---|
| POST | `/auth/login` | 登录 |
| POST | `/auth/logout` | 登出 |
| POST | `/auth/change-password` | 改密 |
| GET | `/auth/me` | 当前用户 |
| GET | `/dashboard/stats` | 仪表盘（可 `?category=`） |
| GET/POST | `/categories` | 类别列表 / 创建 |
| PATCH | `/categories/:id` | 更新名称/启用/排序/描述（**prefix 创建后不可改**） |
| GET/POST | `/batches` | 批次（含 category_id） |
| GET | `/cards` | `?category&status&batch_id&q&page&page_size` |
| POST | `/cards` | 单条创建（**必传 category_id**） |
| POST | `/cards/import` | 批量导入（**必传 category_id**） |
| GET | `/cards/:id` | 详情 |
| PATCH | `/cards/:id` | 状态等（不可改 category） |
| POST | `/cards/batch-action` | 批量禁用/启用 |
| GET | `/cards/export` | 导出 |
| GET | `/redeems` | 兑换记录（可按类别筛） |
| GET/POST | `/api-keys` | API 密钥 |
| DELETE | `/api-keys/:id` | 吊销 |
| GET/PUT | `/settings` | 系统设置 |
| GET | `/audit-logs` | 审计 |

> `code_prefix` **创建后不可修改**（零兼容、避免已发码失效）。

### 7.5 机器录入 API（API Key）

| Method | Path | Scope | 说明 |
|---|---|---|---|
| POST | `/api/v1/m2m/cards` | cards:write | body 含 `category`（slug） |
| POST | `/api/v1/m2m/cards/import` | cards:write | 同上 |
| GET | `/api/v1/m2m/cards` | cards:read | query 可带 category |
| GET | `/api/v1/m2m/categories` | cards:read | 列出可用类别 |

Header: `Authorization: Bearer ck_live_...`

---

## 8. 安全设计

### 8.1 分层

| 层 | 措施 |
|---|---|
| 网络 | 生产 HTTPS；HSTS 由反代；安全响应头（CSP、X-Frame-Options、X-Content-Type-Options） |
| 认证 | 管理员 argon2id；JWT 短寿命（如 2h）+ jti 黑名单登出；API Key 哈希 |
| 授权 | 路由分组隔离 public / admin / m2m |
| 输入 | Zod/后端 validator；长度限制；code 字符白名单 |
| 数据 | content AES-GCM；密钥 env；日志脱敏 code 可保留后 4 位 |
| 滥用 | Redis 滑动窗口：登录、兑换 IP、兑换 code |
| 并发 | FOR UPDATE + 状态条件更新 |
| 会话 | HttpOnly + Secure + SameSite=Lax Cookie 或 Bearer 存 memory（管理端 SPA 推荐 memory + 刷新，避免 XSS 读 localStorage；若 localStorage 需严格 CSP） |
| 密钥管理 | `.env` chmod 600；从不提交 git；安装脚本生成 |

### 8.2 限流默认（可 settings 调整）

| 维度 | 默认 |
|---|---|
| 兑换 / IP | 30 / 分钟 |
| 兑换 / code | 10 / 分钟 |
| 登录 / IP | 10 / 15 分钟 |
| API Key | 按 key 配置 RPM，默认 120 |

### 8.3 验证码

- settings：`captcha.provider = none | turnstile`
- `none` 时依赖限流；生产文档强烈建议 Turnstile
- 前端根据 public config 决定是否渲染组件

### 8.4 管理端前端 Token 策略（推荐）

- 登录接口 Set-Cookie：`HttpOnly` JWT
- 前端 `credentials: 'include'`
- 降级方案：返回 body token 存 sessionStorage（文档说明风险）

---

## 9. 前端信息架构与 UI

### 9.1 路由

| 路径 | 页面 | 鉴权 |
|---|---|---|
| `/` | 兑换页（**类别选择 + 编码**） | 公开 |
| `/admin/login` | 登录 | 访客 |
| `/admin` | 仪表盘 | 需登录 |
| `/admin/categories` | **类别管理** | 需登录 |
| `/admin/cards` | 卡密列表（按类别筛） | 需登录 |
| `/admin/cards/import` | 批量导入（必选类别） | 需登录 |
| `/admin/batches` | 批次 | 需登录 |
| `/admin/redeems` | 兑换记录 | 需登录 |
| `/admin/api-keys` | API 密钥 | 需登录 |
| `/admin/settings` | 设置 | 需登录 |
| `/admin/audit` | 审计日志 | 需登录 |

### 9.2 视觉风格（严格对齐 grok2api）

参考源：https://github.com/chenyme/grok2api `frontend/src/index.css` + `app-shell` + shadcn 组件

| 项 | 规范 |
|---|---|
| 色板 | **中性黑白灰**（非紫蓝品牌色）；primary 亮色模式近黑、暗色模式近白 |
| 圆角 | `--radius: 0.5rem`；按钮 **rounded-full** |
| 控件 | Input/Select：`border-0 bg-secondary/55`、`h-8`、`text-xs` |
| 侧栏 | 固定 **288px**，nav `h-8 text-xs`，active `bg-secondary/60` |
| 主区 | `max-w-[1280px]`，`py-8 lg:py-20` |
| 字体 | Inter + 系统 fallback；正文 14px；编码 monospace |
| 深色 | 默认 dark；可切换 light |
| 兑换端 | 极简居中卡片，无彩色光晕，克制留白 |

### 9.3 原型阶段 = 生产前端 Phase 0

- **直接使用 `frontend/` 正式工程**，不另建 `prototype/` 抛弃目录
- 数据层：`shared/api` + `entities/*`；开发期 `VITE_API_MODE=mock` 走内存 Mock，生产 `VITE_API_MODE=http` 走真实后端——**页面与 features 零改动切换**
- 覆盖全部 P0 页面与主要交互（导入向导、兑换成功/失败态、表格筛选）
- **您确认 UI 后**：只补后端与换 API 适配器，不重做视觉与信息架构
- 禁止：为「临时演示」写一次性烂代码、复制粘贴页、无类型 any 泛滥

---

## 10. 部署设计

### 10.1 Docker Compose（开发/简易生产）

服务：

1. `cardkey` — 应用
2. `postgres` — 数据
3. `redis` — 缓存

卷：`postgres_data`、可选 `cardkey_data`

### 10.2 Dockerfile（multi-stage）

```
stage1: node → pnpm build frontend
stage2: golang → build backend，embed 或 COPY dist
stage3: distroless/alpine 非 root 运行
```

### 10.3 一键安装（私有仓库 · 对齐 sub2api 体验）

**源码不开源**：仓库为 GitHub **Private**。安装分发推荐：

1. **GHCR 私有镜像** + 安装脚本放 Release Asset（需 `GITHUB_TOKEN`）  
2. 或运维机 `git clone` 私有仓后本地 `docker compose`  
3. raw 脚本拉取示例：

```bash
# 需具有 repo 读权限的 token
curl -sSL -H "Authorization: token $GITHUB_TOKEN" \
  https://raw.githubusercontent.com/<USER>/CardKey/main/deploy/docker-deploy.sh | bash
```

脚本行为：

1. 检查 docker / compose / openssl  
2. 下载 compose 与 `.env.example`（鉴权）  
3. 生成 `JWT_SECRET`、`CONTENT_ENCRYPTION_KEY`、`POSTGRES_PASSWORD`  
4. `chmod 600 .env`  
5. `docker compose up -d`（pull 私有镜像时同样带 token/login）  
6. 日志输出 bootstrap 管理员密码  

**禁止**假设匿名 raw.githubusercontent.com 可访问。  

应用启动日志示例：

```
╔══════════════════════════════════════════╗
║  CardKey bootstrap admin created         ║
║  Username: admin                         ║
║  Password: xK9#mP2...                    ║
║  URL:      http://localhost:8080/admin   ║
║  Change password on first login!         ║
╚══════════════════════════════════════════╝
```

### 10.4 环境变量（核心）

| 变量 | 说明 |
|---|---|
| `HTTP_ADDR` | `:8080` |
| `DATABASE_URL` | postgres DSN |
| `REDIS_URL` | redis URL |
| `JWT_SECRET` | ≥32 字节 |
| `CONTENT_ENCRYPTION_KEY` | 32 bytes base64 |
| `APP_ENV` | development / production |
| `BOOTSTRAP_ADMIN_USERNAME` | 可选覆盖 |
| `CORS_ORIGINS` | 生产收紧 |
| `TRUSTED_PROXIES` | 反代 IP |

---

## 11. 高并发设计

| 点 | 方案 |
|---|---|
| 兑换热点 | 行级锁仅锁单行；无全局大锁 |
| 连接池 | pgx pool 按 CPU 配置 |
| Redis | 限流本地失败策略：Redis 宕机时可 fail-closed（兑换拒绝）或 fail-open（可配置，生产建议 closed） |
| 只读扩展 | 列表/统计走只读副本（二期） |
| 导入 | 分批插入，避免超长事务 |
| 静态资源 | Go embed 或 CDN；Cache-Control 哈希文件名 |
| 水平扩展 | 无本地会话状态（JWT+Redis 黑名单）；多实例共享 PG+Redis |

**容量粗估（单 2C4G + PG）：** 兑换 QPS 数百级通常可接受；极限压测在任务阶段补充基准。

---

## 12. 功能 7 维闭环分析

### 12.1 公开兑换

| 维 | 设计 |
|---|---|
| 权限 | 无需登录；受公开 API 与限流约束 |
| 状态 | idle → submitting → success / already_redeemed / error；前端状态机完整 |
| 交互 | 按钮 loading、禁用连点、toast/内联错误、成功复制按钮 |
| 数据 | code 输入 → API → 展示 content；不落前端敏感缓存（可 session 内展示） |
| 生命周期 | 页面按需；离开可清空结果（可选） |
| 依赖 | public config、后端 redeem、限流 Redis |
| 异常 | 网络失败可重试；429 提示稍后；5xx 友好文案 |

### 12.2 管理登录

| 维 | 设计 |
|---|---|
| 权限 | 用户名密码；must_change_password 拦截进后台 |
| 状态 | 未登录/已登录/强制改密 |
| 交互 | 错误提示不暴露「用户是否存在」可统一「账号或密码错误」 |
| 数据 | Cookie JWT；登出黑名单 |
| 生命周期 | token 过期跳转登录 |
| 依赖 | admin 表、JWT_SECRET |
| 异常 | 限流锁定提示 |

### 12.3 批量导入

| 维 | 设计 |
|---|---|
| 权限 | JWT 或 API Key cards:write |
| 状态 | 编辑 → 上传解析预览 → 提交中 → 结果（成功数/失败行） |
| 交互 | 拖拽文件、预览前 N 行、进度 |
| 数据 | 明文仅传输 TLS；服务端加密入库；响应返回 codes |
| 生命周期 | 大导入异步化二期；v1 同步 + 超时调大 |
| 依赖 | batch、crypto、DB |
| 异常 | 部分失败回滚整批（v1 全有或全无 per chunk） |

### 12.4 API Key

| 维 | 设计 |
|---|---|
| 权限 | 仅管理员创建；明文仅创建时一次 |
| 状态 | active / revoked / expired |
| 交互 | 创建弹窗强制复制确认 |
| 数据 | 只存 hash |
| 异常 | 泄露后吊销立即生效（下一次请求） |

### 12.5 Bootstrap 安装

| 维 | 设计 |
|---|---|
| 权限 | 仅无 admin 时执行一次 |
| 状态 | 空库 → 有 admin |
| 交互 | 终端输出；UI 首次登录改密 |
| 数据 | 密码不写盘 |
| 异常 | 并发双启动：DB UNIQUE username 兜底 |

---

## 13. 模块接口（后端核心）

```go
// 示意，非最终代码

type CardService interface {
    Create(ctx, in CreateCardInput) (*Card, error)
    Import(ctx, in ImportInput) (*ImportResult, error)
    List(ctx, q ListQuery) (*Page[Card], error)
    Get(ctx, id, reveal bool) (*Card, error)
    BatchAction(ctx, ids []ID, action Action) error
}

type RedeemService interface {
    Redeem(ctx, code string, meta RedeemMeta) (*RedeemResult, error)
}

type AuthService interface {
    Login(ctx, user, pass, ip string) (*TokenPair, error)
    Logout(ctx, jti string) error
    ChangePassword(ctx, adminID, old, new string) error
}

type ApiKeyService interface {
    Create(ctx, in) (plaintext string, meta *ApiKey, err error)
    Verify(ctx, rawKey string) (*ApiKeyPrincipal, error)
    Revoke(ctx, id ID) error
}
```

---

## 14. 日志与审计

- 每请求 `request_id`（中间件注入，响应头 `X-Request-ID`）
- 业务日志：action、耗时、outcome；**禁止**打印 content 明文、password、完整 API Key
- 审计：登录成败、导入、作废、密钥创建/吊销、设置变更、reveal content

---

## 15. 测试策略

| 层级 | 内容 |
|---|---|
| 单元 | code 生成、加解密、状态机、限流 key |
| 集成 | redeem 并发只成功一次（`go test -race` + 并行 goroutine） |
| API | httptest 公开/管理鉴权矩阵 |
| 前端 | 关键表单校验、路由守卫 |
| 手工 | Docker 全链路、一键脚本 dry-run |

---

## 16. 里程碑与开发顺序

```
M0  设计确认（本文档）
M1  高保真前端原型（Mock）→ UI 确认门禁
M2  后端骨架 + 迁移 + Docker Compose
M3  认证 + Bootstrap + 卡密 CRUD/导入
M4  兑换强一致 + 公开 API + 限流
M5  管理端接真 API + 仪表盘/记录/API Key
M6  安全加固 + 审计 + 设置
M7  一键安装脚本 + README + 压测基线
```

**硬门禁：M1 未获您 UI 确认前，不进入 M2 业务开发。**  
（骨架仓库与 Docker 空跑可与 M1 并行准备，但不实现业务接口。）

---

## 17. 风险与决策记录

| 决策 | 选择 | 备选 |
|---|---|---|
| 路由 | chi | Gin |
| ORM | pgx + SQL | GORM |
| 已兑再查 | 默认允许 | 可关 |
| 防枚举 | 部分统一错误 | 全统一 |
| 验证码 | 可配置，默认 none + 强限流 | Turnstile |
| 前端鉴权 | HttpOnly Cookie 优先 | Bearer sessionStorage |
| 失败兑换落库 | v1 不落 | P2 可选 |

---

## 18. 明确不在 v1 范围

- 支付、商城、多租户
- 复杂 RBAC / 多角色
- 邮件短信通知
- 卡密内容为大文件/对象存储
- 多密钥自动轮换 UI
- K8s Helm（可二期）

---

## 请确认

请审阅本设计是否合理，重点确认：

1. 技术栈（Go chi + pgx、React shadcn、PG + Redis）  
2. 编码格式 `CK-XXXX-XXXX-XXXX-XXXX`  
3. 兑换再查询默认开启  
4. 管理端 Cookie JWT 方案  
5. 原型门禁后再接后端  
6. API 路径与错误码策略  

- 需修改：直接指出章节  
- **认可：请回复「设计确认」**  

确认后将编写 `TASKS.md`（仍需您确认任务拆分后才开始原型开发）。
