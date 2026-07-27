# CardKey

**语言 / Language:** [中文](README.md) · [English](README_EN.md)

自托管高并发卡密兑换平台：公开兑换端 + 管理端 + HTTP API。

[![Go](https://img.shields.io/badge/Go-1.22+-00ADD8)](https://go.dev/)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)](https://www.postgresql.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 功能概览

- **公开兑换**：按类别 Tab、单码/批量兑换、结果 ZIP 导出
- **卡密管理**：创建、批量导入、启用/禁用/删除、批次
- **类别隔离**：独立编码前缀；无交易可删，有记录仅停用
- **API 密钥**：固定兑换密钥 + 自定义 Key（吊销/删除/轮换）
- **API 文档**：公开 `/docs` + 管理端「API 文档」；Base URL 可配置并动态展示
- **品牌资源**：Logo / Favicon 支持上传
- **首次安装向导**：对齐 sub2api，Web 端创建管理员
- **运维**：健康检查、受保护指标、**默认启用在线更新**（Docker 检测 / 可选 Token 防 GitHub 限流）
- **安全**：生产密钥校验、CSRF 同源、安装 advisory lock、默认不暴露兑换密钥、禁止 SVG 上传
- **发版**：改 `VERSION` → `bash scripts/release.sh`（tag + Release + **Linux amd64/arm64** 供一键更新；不含 Win/mac）

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 · Vite · Tailwind 4 · TanStack Query |
| 后端 | Go · chi · pgx · Redis |
| 数据 | PostgreSQL 16 · Redis 7 |
| 部署 | Docker Compose 一键 |

## 一键部署（推荐）

### 前置

- Docker 20+ / Docker Compose v2
- Linux / macOS / Windows（Docker Desktop）
- `git`、`bash`（Windows 可用 Git Bash）

### 方式 A：克隆后交互安装（推荐）

```bash
git clone https://github.com/hkx1997/CardKey.git
cd CardKey
bash deploy/docker-deploy.sh
```

安装过程中会**交互询问**（直接回车=默认）：

| 项 | 默认 | 说明 |
|----|------|------|
| 应用端口 `APP_PORT` | 18080 | 管理端 / 兑换页 |
| Postgres 端口 | 5432 | 宿主机映射 |
| Redis 端口 | 6379 | 宿主机映射 |
| 数据库用户/库名 | cardkey | |
| 数据库密码 | 随机 | 也可自定义 |

并会**检测端口是否被占用**；冲突时提示更换（非交互模式自动选空闲端口）。

```bash
# 非交互（CI / 无人值守，可用环境变量覆盖）
APP_PORT=19000 bash deploy/docker-deploy.sh --yes

# 强制重新配置 .env
bash deploy/docker-deploy.sh --reconfig
```

### 方式 B：在线一键（Linux/macOS）

```bash
curl -fsSL https://raw.githubusercontent.com/hkx1997/CardKey/main/deploy/install-online.sh | bash
```

默认安装到 `~/cardkey`。自定义目录：

```bash
CARDKEY_DIR=/opt/cardkey bash -c \
  'curl -fsSL https://raw.githubusercontent.com/hkx1997/CardKey/main/deploy/install-online.sh | bash'
```

> 通过管道安装时通常**没有交互终端**，会走默认端口；若冲突会自动顺延。需要交互配置请用方式 A。

### 方式 C：纯手动

```bash
cp .env.example .env
# 编辑 APP_PORT、POSTGRES_PASSWORD、JWT_SECRET、CONTENT_KEY 等
docker compose up -d --build
```

### 访问

- 兑换页：`http://服务器IP:APP_PORT/`（默认 **18080**）
- 管理端：`http://服务器IP:APP_PORT/admin`

### 首次安装

1. 打开管理端  
2. 若尚无管理员 → 自动进入 **`/admin/setup` 安装向导**  
3. 设置管理员用户名/密码、站点名、是否安装演示数据  
4. 完成后自动登录  

> 也可在 `.env` 设置 `BOOTSTRAP_ADMIN_PASS` 启动时自动建号（适合脚本，不推荐生产裸奔）。

### 可配置项（`.env`）

| 变量 | 默认 | 说明 |
|------|------|------|
| `APP_PORT` | 18080 | 应用对外端口 |
| `POSTGRES_PORT` | 5432 | PostgreSQL 宿主机端口 |
| `REDIS_PORT` | 6379 | Redis 宿主机端口 |
| `POSTGRES_USER` / `POSTGRES_DB` | cardkey | 数据库用户/库名 |
| `POSTGRES_PASSWORD` | — | **生产务必改强密码** |
| `JWT_SECRET` | — | ≥32 字符随机串 |
| `CONTENT_KEY` | — | 64 hex（`openssl rand -hex 32`），卡密加密 |
| `BOOTSTRAP_ADMIN_PASS` | 空 | 空=走安装向导 |

### 常用命令

```bash
docker compose ps
docker compose logs -f cardkey
docker compose down          # 停服务（保留数据卷）
# 切勿：docker compose down -v  （删除数据库）
bash scripts/upgrade.sh      # 推荐升级：只重建 cardkey，不动 postgres 卷
# 数据说明见 deploy/DATA_SAFETY.md（up --build 挂错空卷也会像「库被清空」）
```

### 生产建议

1. 修改全部默认密钥与数据库密码  
2. 前置 Nginx/Caddy HTTPS，并设 `SECURE_COOKIE=true`  
3. 定期 `pg_dump` 备份 `postgres` 卷  
4. 防火墙只暴露 `APP_PORT`（或仅 443）

## 演示数据

向导勾选「演示数据」后可用：

| 类别 | 示例编码 |
|------|----------|
| VIP | `VIP-DEMO-7K3M-9P2X-W4QH` |
| CDK | `CDK-DEMO-A2B3-C4D5-E6F7` |

## 开发

```bash
# 前端 Mock
cd frontend && pnpm install && pnpm dev

# 后端（需本机 PG + Redis）
cd backend && go run ./cmd/cardkey

# 测试
cd frontend && pnpm test
cd backend && go test ./...
```

## API 摘要

统一响应：

```json
{ "success": true, "data": {} }
```

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/public/config` | 公开配置 |
| GET | `/api/v1/public/setup-status` | 是否需安装向导 |
| POST | `/api/v1/public/setup` | 完成首次安装 |
| POST | `/api/v1/public/redeem` | 兑换 |
| POST | `/api/v1/admin/auth/login` | 登录 |
| GET | `/healthz` / `/readyz` | 健康检查 |
| GET | `/metrics` | Prometheus 文本指标 |

## 许可

[MIT](LICENSE)
