# CardKey — 任务文档

| 项 | 内容 |
|---|---|
| 关联设计 | [DESIGN.md](./DESIGN.md) v1.2 |
| 关联需求 | [REQUIREMENTS.md](./REQUIREMENTS.md) |
| 原则 | **原型即产品** · **零历史兼容** · **始终最优** |
| 状态 | ✅ 全面完成（前端原型 + Go 后端 + Docker 全栈） |

## 任务总览

| 阶段 | 说明 | 状态 |
|---|---|---|
| M1 | 生产级前端 + 高保真 Mock UI | ✅ |
| M2 | 后端骨架 + Docker + 迁移 | ✅ |
| M3 | 认证 / Bootstrap / 卡密 CRUD·导入 | ✅ |
| M4 | 兑换强一致 + 公开 API + 限流 | ✅ |
| M5 | 管理端接真 API（`VITE_API_MODE=http` 镜像） | ✅ |
| M6 | 安全头 / 审计 / 设置 | ✅ |
| M7 | 一键安装 + README + 基线验证 | ✅ |

## 验证

```bash
# 单元测试
cd frontend && pnpm test
cd backend && go test ./...

# 全栈
docker compose up -d --build
# http://localhost:18080  (见 .env APP_PORT)
powershell -File scripts/verify-api.ps1
```

演示账号：`admin` / `admin123`  
演示卡密：`VIP-DEMO-…` / `CDK-DEMO-…`
