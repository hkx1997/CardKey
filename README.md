# CardKey

**语言 / Language:** [中文](README.md) · [English](README_EN.md)

自托管卡密兑换系统：面向高并发场景，提供公开兑换页、管理控制台与统一 HTTP API。

[![Go](https://img.shields.io/badge/Go-1.22+-00ADD8)](https://go.dev/)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)](https://www.postgresql.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

| | |
|---|---|
| **官方站点** | [cardkey.ai-service.top](https://cardkey.ai-service.top/) |
| **公开 API 文档** | [cardkey.ai-service.top/docs](https://cardkey.ai-service.top/docs) |
| **管理端** | [cardkey.ai-service.top/admin](https://cardkey.ai-service.top/admin) |

---

## 界面预览

### 公开兑换

| 单码兑换 | 批量兑换 |
|:---:|:---:|
| ![公开兑换](docs/screenshots/redeem.png) | ![批量兑换](docs/screenshots/redeem-batch.png) |

按类别组织库存；支持单码与批量兑换，结果可导出。

### API 文档

| 概览 | 接口列表 |
|:---:|:---:|
| ![API 文档](docs/screenshots/api-docs.png) | ![接口列表](docs/screenshots/api-docs-endpoints.png) |

公开路径 `/docs`：接口说明与多语言请求示例。Base URL 为站点 origin，路径前缀为 `/api/v1`。管理端另提供完整管理 API 文档。

### 管理端

![管理端登录](docs/screenshots/admin-login.png)

完成安装后访问 `/admin`：类别、卡密、批次、API 密钥、站点设置、审计日志与在线更新等。

---

## 功能

### 业务

- **公开兑换**：类别导航、单码 / 批量兑换、结果 ZIP 导出
- **库存管理**：创建、批量导入、启用 / 禁用 / 删除，支持批次
- **类别隔离**：独立编码前缀；无兑换记录可删除，已有记录仅允许停用
- **API 密钥**：系统兑换密钥与自定义密钥（吊销、删除、轮换；权限范围控制）

### 平台

- **安装向导**：首次部署时创建管理员与站点名称（不写入示例业务数据）
- **品牌与文案**：Logo / Favicon 上传，兑换页与站点文案可配置
- **API 文档**：公开 `/docs` 与管理端文档；可配置对外 Base URL
- **可观测性**：`/healthz`、`/readyz`、受保护的 Prometheus `/metrics`

### 安全与运维

- 生产环境密钥强度校验、Cookie 会话 CSRF 同源校验
- 安装过程 advisory lock，降低并发初始化风险
- 卡密内容 AES-GCM 加密存储；默认不在公开配置中暴露兑换密钥
- 禁止 SVG 等风险格式作为上传资源
- **在线更新**（Docker / 二进制）：自 GitHub Release 拉取 **Linux amd64/arm64** 完整包（后端 + 嵌入前端 SPA + 数据库迁移），重启后自动执行未应用迁移，**不删除数据卷**

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 · Vite · Tailwind CSS 4 · TanStack Query |
| 后端 | Go · chi · pgx |
| 数据 | PostgreSQL 16 · Redis 7 |
| 部署 | Docker Compose |

---

## 部署

### 环境要求

- Docker 20+ / Docker Compose v2
- Linux、macOS 或 Windows（Docker Desktop）
- `git`、`bash`（Windows 建议使用 Git Bash）

### 方式 A：交互式安装（推荐）

```bash
git clone https://github.com/hkx1997/CardKey.git
cd CardKey
bash deploy/docker-deploy.sh
```

安装程序将引导配置端口与数据库密码，并检测宿主机端口占用：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `APP_PORT` | `18080` | 应用对外端口（兑换页与管理端） |
| PostgreSQL 端口 | `5432` | 宿主机映射 |
| Redis 端口 | `6379` | 宿主机映射 |
| 数据库用户 / 库名 | `cardkey` | |
| 数据库密码 | 随机生成 | 可自定义 |

```bash
# 非交互（CI / 自动化；可用环境变量覆盖）
APP_PORT=19000 bash deploy/docker-deploy.sh --yes

# 重新生成 / 覆盖 .env
bash deploy/docker-deploy.sh --reconfig
```

### 方式 B：在线安装（Linux / macOS）

```bash
curl -fsSL https://raw.githubusercontent.com/hkx1997/CardKey/main/deploy/install-online.sh | bash
```

默认安装目录为 `~/cardkey`。自定义路径：

```bash
CARDKEY_DIR=/opt/cardkey bash -c \
  'curl -fsSL https://raw.githubusercontent.com/hkx1997/CardKey/main/deploy/install-online.sh | bash'
```

通过管道安装时通常无交互终端，将使用默认端口；若冲突则自动顺延。需要交互配置时请使用方式 A。

### 方式 C：手动部署

```bash
cp .env.example .env
# 配置 APP_PORT、POSTGRES_PASSWORD、JWT_SECRET、CONTENT_KEY 等
docker compose up -d --build
```

### 访问地址

| 入口 | URL |
|------|-----|
| 兑换页 | `http://<主机>:<APP_PORT>/`（默认端口 `18080`） |
| 管理端 | `http://<主机>:<APP_PORT>/admin` |

### 首次初始化

1. 打开管理端  
2. 若系统中尚无管理员，将进入 **`/admin/setup`**  
3. 设置管理员用户名、密码与站点名称  
4. 完成后自动登录  

也可通过环境变量 `BOOTSTRAP_ADMIN_PASS` 在进程启动时创建管理员（适用于自动化脚本；生产环境建议使用强密码并完成首次改密）。

### 主要环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `APP_PORT` | `18080` | 应用对外端口 |
| `POSTGRES_PORT` | `5432` | PostgreSQL 宿主机端口 |
| `REDIS_PORT` | `6379` | Redis 宿主机端口 |
| `POSTGRES_USER` / `POSTGRES_DB` | `cardkey` | 数据库用户 / 库名 |
| `POSTGRES_PASSWORD` | — | 生产环境请使用高强度密码 |
| `JWT_SECRET` | — | 随机字符串，长度 ≥ 32 |
| `CONTENT_KEY` | — | 64 位十六进制（`openssl rand -hex 32`），用于卡密内容加密 |
| `BOOTSTRAP_ADMIN_PASS` | 空 | 为空时使用 Web 安装向导 |

完整示例见 [`.env.example`](.env.example)。

### 运维命令

```bash
docker compose ps
docker compose logs -f cardkey
docker compose down                 # 停止服务，保留数据卷
bash scripts/upgrade.sh             # 推荐升级：仅重建应用，不触碰数据库卷
bash scripts/recover-volume.sh      # 疑似挂载空卷时，协助找回既有 Postgres 数据
```

**请勿**执行 `docker compose down -v` 或对 Postgres 卷进行 `docker volume rm` / `prune`，否则将删除业务数据。数据安全说明见 [`deploy/DATA_SAFETY.md`](deploy/DATA_SAFETY.md)。

### 生产环境建议

1. 使用高强度 `POSTGRES_PASSWORD`、`JWT_SECRET`、`CONTENT_KEY`，避免示例或弱默认值  
2. 前置 HTTPS 反向代理（Nginx / Caddy 等），并设置 `SECURE_COOKIE=true`  
3. 定期对 PostgreSQL 执行 `pg_dump` 备份  
4. 防火墙仅开放必要端口（应用端口或 443）  
5. 升级优先使用 `scripts/upgrade.sh` 或管理端在线更新，避免误删数据卷  

维护者发版流程见 [`AGENTS.md`](AGENTS.md) 与 `scripts/release.sh`（产物为内嵌 SPA 与迁移的 Linux 二进制）。

---

## 本地开发

```bash
# 前端（Mock 或代理，见 frontend 环境变量）
cd frontend && pnpm install && pnpm dev

# 后端（需本机 PostgreSQL 与 Redis，并配置环境变量）
cd backend && go run ./cmd/cardkey

# 测试
cd frontend && pnpm test
cd backend && go test ./...
```

---

## API 概要

统一响应信封：

```json
{ "success": true, "data": {} }
```

```json
{ "success": false, "error": { "code": "...", "message": "..." } }
```

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/public/config` | 公开站点配置 |
| GET | `/api/v1/public/setup-status` | 是否需要安装向导 |
| POST | `/api/v1/public/setup` | 完成首次安装 |
| POST | `/api/v1/public/redeem` | 兑换 |
| POST | `/api/v1/admin/auth/login` | 管理员登录 |
| GET | `/healthz` · `/readyz` | 存活 / 就绪探针 |
| GET | `/metrics` | Prometheus 指标（生产建议配置访问令牌） |

完整接口说明以部署实例的 `/docs` 与管理端 API 文档为准。

---

## 许可

[MIT](LICENSE)
