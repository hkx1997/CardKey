# CardKey

自托管高并发卡密兑换平台：公开兑换端 + 管理端 + HTTP API。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 · Vite · Tailwind 4 · TanStack Query |
| 后端 | Go · chi · pgx · Redis |
| 数据 | PostgreSQL 16 · Redis 7 |
| 部署 | Docker Compose 一键 |

## 快速启动（全栈）

```bash
# 推荐：生成 .env（端口/库密码）并启动
bash deploy/docker-deploy.sh

# 或手动
cp .env.example .env   # 修改端口与 POSTGRES_PASSWORD
docker compose up -d --build
```

打开 **http://localhost:18080**（见 `.env` 的 `APP_PORT`）。

### 端口与数据库

| 变量 | 默认 | 说明 |
|------|------|------|
| `APP_PORT` | 18080 | 应用对外端口 |
| `POSTGRES_PORT` | 5432 | PostgreSQL 宿主机端口 |
| `REDIS_PORT` | 6379 | Redis 宿主机端口 |
| `POSTGRES_USER` / `POSTGRES_DB` | cardkey | 数据库用户/库名 |
| `POSTGRES_PASSWORD` | （示例） | **生产务必改强密码** |

### 首次安装（对齐 sub2api）

1. 打开 `http://localhost:<APP_PORT>/admin`
2. 若尚无管理员 → 自动进入 **安装向导** `/admin/setup`
3. 设置：管理员账号、密码、站点名、是否安装演示数据
4. 完成后自动登录进入后台

也可在 `.env` 填写 `BOOTSTRAP_ADMIN_PASS`，启动时自动建号（跳过向导）。

演示兑换码（勾选「演示数据」后）：

- VIP：`VIP-DEMO-7K3M-9P2X-W4QH`
- CDK：`CDK-DEMO-A2B3-C4D5-E6F7`

```bash
docker compose logs cardkey
```

## 前端原型（Mock，可选）

```bash
docker compose --profile mock up -d --build frontend-mock
# http://localhost:5173  纯前端 Mock
```

本地热更新：

```bash
cd frontend && pnpm install && pnpm dev
# VITE_API_MODE=mock（默认）或 http + 代理到 :8080
```

## API 契约

统一信封：

```json
{ "success": true, "data": {}, "error": null }
```

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/public/config` | 公开配置 + 类别 |
| POST | `/api/v1/public/redeem` | `{ "category","code" }` 兑换 |
| POST | `/api/v1/admin/auth/login` | 管理登录（Cookie JWT） |
| * | `/api/v1/admin/*` | 需登录 |

健康检查：`GET /healthz`

## 开发命令

```bash
make up          # compose 全栈
make down
make logs
cd frontend && pnpm test && pnpm build
cd backend && go test ./...
```

## 一键脚本

```bash
bash deploy/docker-deploy.sh
```

## 许可

私有项目，默认不对外开源。
