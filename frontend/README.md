# CardKey Frontend

生产级 React 前端（原型即产品 · 零历史兼容）。

## 开发

```bash
pnpm install
pnpm dev
```

- 兑换端：http://127.0.0.1:5173/ （先选类别再兑）
- 管理端：http://127.0.0.1:5173/admin · Mock `admin` / `admin123`

演示码：

| 类别 | 编码 |
|---|---|
| 会员卡 VIP | `VIP-DEMO-7K3M-9P2X-W4QH` |
| 激活码 CDK | `CDK-DEMO-A2B3-C4D5-E6F7` |

`VITE_API_MODE=mock|http` 切换数据源。

## 共享层

- `components/ui` — 设计系统
- `shared/components` — PageHeader / CategorySelect / PaginationBar / CopyButton
- `shared/api` — 统一 client + mock/http + `ApiEnvelope` / `ApiError`
- `entities` — 领域类型（含 Category）
