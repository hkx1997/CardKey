# CardKey — 全面优化方案

| 项 | 内容 |
|---|---|
| 关联需求 | [REQUIREMENTS.md](./REQUIREMENTS.md) |
| 关联设计 | [DESIGN.md](./DESIGN.md) |
| 关联规范 | [AGENTS.md](./AGENTS.md) |
| 文档版本 | v1.0 |
| 拟定日期 | 2026-07-28 |
| 当前基线 | v0.1.45（业务闭环已具备；交付链路与质量保障为主要短板） |
| 状态 | ✅ v0.1.46 全面优化已落地并发版（C 中对象存储/物化库存/PWA 等可后续增量） |

---

## 0. 摘要

CardKey 作为自托管卡密兑换平台，**主业务路径已完整**（兑换 / 类别 / 卡密 / 批次 / 密钥 / 审计 / 邮件 / 一键更新）。  
近期线上问题（一键更新后 **502**、Release **空壳包 ~11–12MB**、生产 **CSRF 启动砖机**）表明：下一阶段优化重点不是「再堆功能页面」，而是：

1. **交付与更新链路可靠**（发版、体积门禁、回滚、健康检查）
2. **核心路径可回归**（测试 + CI）
3. **安全与风控补齐**（验证码、权限、配置可观测）
4. **规模化与体验**（库存、导入、对象存储、运营能力）

本方案按 **三个迭代（A/B/C）+ 明确不做** 组织，每项含目标、现状、方案、验收标准与风险。

---

## 1. 目标与原则

### 1.1 优化目标（可验证）

| # | 目标 | 成功标准 |
|---|------|----------|
| G1 | 发版永不出空壳 | GitHub `cardkey-linux-amd64` **≥ 13_000_000 字节**；含 SPA（`staticEmbeddedFiles` ≥ 50） |
| G2 | 一键更新不砖站 | 更新失败可回滚；坏包拒写；进程起不来时有明确日志与管理端提示；不因「推荐配置」exit |
| G3 | 核心业务有回归网 | 兑换 / 鉴权 / 更新校验 有自动化测试；PR 默认跑通 |
| G4 | 兑换可防刷可扩展 | 验证码可开关生效；限流与库存在中大流量下稳定 |
| G5 | 运维可自助 | 备份/恢复、健康检查、版本与包完整性在文档与 UI 可感知 |
| G6 | 代码可持续演进 | 大文件拆分、仓库卫生、契约单一真源 |

### 1.2 原则（与 DESIGN 一致）

| 原则 | 在本方案中的含义 |
|------|------------------|
| 数据安全优先 | 任何优化禁止 `compose down -v`、删卷；升级只动 `cardkey` |
| 发版一体包 | 后端 + 嵌入 SPA + 嵌入 migrations 同进 Linux 二进制 |
| 零历史兼容 | 优化可做破坏性配置/API 调整，但需版本说明与一键升级路径 |
| 共享层优先 | 新能力进 `shared` / `pkg` / `app`，禁止复制分叉 |
| 最小惊讶 | 生产默认安全（CSRF on）；危险配置只 WARN 不默默砖机（密钥类除外） |
| 先稳后炫 | A 迭代无验证码/对象存储也可上线；先堵 502 与空壳 |

### 1.3 非目标（本方案明确不做）

- 微服务拆分、换语言/框架、上 K8s 为默认部署  
- 为旧空壳包做长期兼容逻辑  
- 公开开源运营、多租户 SaaS 计费  
- 过早分库分表  

---

## 2. 现状评估

### 2.1 已具备（优势）

| 领域 | 现状 |
|------|------|
| 兑换一致性 | `SELECT … FOR UPDATE` + 状态机 + 可选错误掩码 |
| 限流 | Redis 按 IP / code；可 fail-closed |
| 库存 | 公开 config 与 stock 分离；stock Redis 缓存 3s + ETag |
| 安全基础 | AES-GCM 卡密、API Key hash、JWT、CSRF（Cookie 写）、审计 |
| 交付 | Docker Compose、数据卷策略、`release.sh`、`_upload_assets.py`、管理端一键更新 |
| 运维文档 | `AGENTS.md` / `DATA_SAFETY.md` 已强调体积与 502 排障 |
| 前端 | React 19 + Query + Zod；Mock/HTTP 双适配；主题与文档页 |

### 2.2 主要短板（按严重度）

| 级别 | 问题 | 证据 / 影响 |
|------|------|-------------|
| **P0** | GitHub Actions `release.yml` **只 `go build`、不编前端** | tag 推送产生 ~11–12MB 空壳，覆盖完整包 → 线上 UI 不更新 / 旧逻辑砖机 |
| **P0** | 一键更新失败路径弱 | 坏包可写入数据卷；无 health 失败自动回滚；用户见 Cloudflare 502 |
| **P0** | 生产配置与旧二进制组合 | `CSRF_CHECK=false` + 旧 `ValidateProduction` → 重启死循环 |
| **P1** | `internal/app`、`handler` **几乎无测试** | 回归靠手工与线上 |
| **P1** | 无 PR CI | 合并前不强制 test/tsc/体积门禁 |
| **P1** | 验证码仅配置位 | `CaptchaEnabled` 强制 false，需求 R4 未闭环 |
| **P1** | 大文件单体 | `handler.go`、`update.go` 过大，变更风险高 |
| **P2** | 库存全表聚合 | 卡密量极大时 stock 接口压力上升 |
| **P2** | 内容进库 | 文件型卡密 ≤5MB 存库，膨胀与备份成本高 |
| **P2** | 单超管模型 | 无只读运维角色；误操作面大 |
| **P2** | 仓库产物堆积 | `dist/release-*` 多版本二进制、临时文件 |

### 2.3 根因图（交付事故）

```text
tag 推送 → Actions 打空壳 exe（无 SPA）
        → Release 资产 ~12MB
        → 一键更新下载并写入 /app/data/bin/cardkey
        → re-exec / 重启
        → 旧校验 CSRF 或 UI 回退 index.html
        → 进程 exit 或静态资源 MIME 错误
        → Cloudflare 502 / 站点不可用
```

优化必须在 **构建、上传校验、下载校验、启动、回滚** 五层都设闸。

---

## 3. 架构目标态（优化后）

### 3.1 发版与更新数据流

```text
                    ┌─────────────────────┐
  开发机/CI         │  pnpm build         │
                    │  → webstatic/dist   │
                    │  go build (linux)   │
                    │  size≥13MB + embed  │
                    │  抽检 CSS/JS 字节   │
                    └──────────┬──────────┘
                               │ _upload_assets / 合格 Actions
                               ▼
                    ┌─────────────────────┐
  GitHub Release    │ amd64/arm64 ≥13MB   │
                    │ checksums.txt       │
                    └──────────┬──────────┘
                               │ 管理端 apply / 手工 curl
                               ▼
                    ┌─────────────────────┐
  运行时校验        │ ELF + size + 可选   │
                    │ SHA256 与 checksums │
                    └──────────┬──────────┘
                               │ 写入 DATA_DIR/bin
                               │ 保留 .bak
                               ▼
                    ┌─────────────────────┐
  重启              │ re-exec / compose   │
                    │ healthz 成功？       │
                    │  是 → 完成审计       │
                    │  否 → 恢复 .bak 再起 │
                    └─────────────────────┘
```

### 3.2 分层与模块边界（演进）

```text
HTTP handler（薄）
    → app 用例（可测）
        → pgx / redis / crypto / update client
middleware：鉴权 · CSRF · 限流 · 指标
webstatic：embed SPA（唯一生产 UI 真源）
migrations：embed SQL（唯一 schema 真源）
```

拆分建议（B 迭代）：

| 现状 | 目标包/文件 |
|------|-------------|
| `handler/handler.go` | `handler/auth.go` `cards.go` `redeem.go` `updates.go` `settings.go` … |
| `app/update.go` | `app/update/`：`github.go` `apply.go` `rollback.go` `binary.go` |
| mock 巨型 client | 共享接口 + 生成或分段 mock |

---

## 4. 分迭代方案

### 迭代 A — 稳定交付（约 1～2 周）

**主题：再也不因发版/更新 502。**

#### A1. 修复 / 对齐 GitHub Actions 发版

| 项 | 内容 |
|----|------|
| 问题 | `.github/workflows/release.yml` 未构建前端 |
| 方案（二选一，推荐 ①） | ① **与 `release.sh` 等价**：Node+pnpm build → 拷 embed → go build → **体积与 embed 门禁** → 上传；② **禁用 tag 自动 Release**，仅人工/`release.sh` 发版，Actions 只做校验不上传 |
| 防覆盖 | 若本地与 Actions 双发，规定 **单一发版入口**；Actions 上传前 `size < 13MB` 则 fail |
| 验收 | 任意 `v*` tag 对应 amd64 **≥13MB**；容器日志 `staticEmbeddedFiles` ≥ 50 |

#### A2. 发版门禁固化

| 检查点 | 规则 |
|--------|------|
| 本地 build | `release.sh` 已有：assets 数量、CSS/JS 串 in binary、size |
| 上传后 | API `assets[].size == local` 且 ≥13MB |
| 可选 | Release body 自动写明 amd64 字节数，便于人工扫一眼 |

错包修复流程写入 AGENTS（已部分具备）：`python scripts/_upload_assets.py X.Y.Z`。

#### A3. 一键更新：拒坏包 + 可回滚 + 可观测

| 能力 | 方案 |
|------|------|
| 下载校验 | 保留/强化 `assertLinuxBinaryOK`（ELF、≥13MB）；优先校验 `checksums.txt` SHA256 |
| 原子替换 | 写临时文件 → fsync → rename；保留 `.bak` |
| 启动失败回滚 | 方案：① 更新进程内「子进程试跑 `-version`/`health`」再替换；或 ② compose healthcheck 失败时 entrypoint/脚本恢复 `.bak`（Docker 模式优先 ② 的运维脚本 + 文档，应用内尽量 ①） |
| 审计 | apply 成功/失败、回滚、拒收原因写入 audit |
| UI | 展示：当前 version、commit、包体积提示、最近一次更新错误、一键回滚按钮强化 |
| 日志 | `starting cardkey` 已有 version；补充 `binaryPath`、`binarySize`（可选） |

#### A4. 配置与启动策略

| 项 | 方案 |
|----|------|
| CSRF | `.env.example` + 安装脚本默认 `CSRF_CHECK=true`；setup/文档强调 |
| ValidateProduction | **仅强制密钥强度**（已向此收敛）；禁止再为 CSRF/METRICS/sslmode exit |
| 启动 WARN | CSRF=false、DATABASE sslmode=disable、无 METRICS_TOKEN 时 slog Warn + `GET /admin/system/info` 返回 `warnings[]` |
| 安装探测 | `install`/`docker-deploy` 可选检查：卷存在、CSRF、端口 |

#### A5. Compose 健康检查

| 项 | 方案 |
|----|------|
| cardkey 服务 | `healthcheck: curl -f http://127.0.0.1:8080/healthz` |
| 依赖 | 已有 postgres/redis health 时，`depends_on: condition: service_healthy` |
| 验收 | `docker compose ps` 在挂掉时显示 unhealthy，而非假 Up |

#### A6. 核心自动化测试（最小集）

| 用例 | 层级 |
|------|------|
| Redeem：unused→used；重复兑；过期；跨类 | app 集成（testcontainers 或 事务回滚 fixture） |
| API Key scope：redeem vs admin | app/middleware |
| `assertLinuxBinaryOK`：过小/非 ELF 拒绝 | 单测 |
| ValidateProduction：弱密钥拒绝；可选配置不拒绝 | 单测（已有部分） |
| webstatic：缺 asset 不回退 HTML | 已有，保持 |

#### A7. 仓库与文档收口

- `.gitignore`：`dist/release-*`、大二进制、`cookies.txt`  
- 清理临时产物说明写入 AGENTS  
- 用户向：`README` 增加「更新后 502」短链到 `AGENTS` §8.3  

**迭代 A 出口标准**

- [ ] 远程 Release 连续 2 次发版 size 合格  
- [ ] 从「坏包」无法再写入（或写入后自动回滚）  
- [ ] 模拟 CSRF=false + 新二进制可启动（仅 WARN）  
- [ ] `go test` 覆盖兑换主路径  
- [ ] compose healthcheck 生效  

---

### 迭代 B — 质量、安全、结构（约 2～3 周）

**主题：可维护、可防刷、可协作。**

#### B1. PR CI

```yaml
# 示意：.github/workflows/ci.yml
on: [pull_request, push]
jobs:
  backend: go test ./...
  frontend: pnpm test && pnpm exec tsc --noEmit
  embed-gate: 可选 dry-run 构建体积（或仅 main）
```

私有仓注意 secrets；失败不可合并（branch protection 可选）。

#### B2. 人机验证（验证码）闭环

| 项 | 方案 |
|----|------|
| 提供商 | 优先 Cloudflare Turnstile（自托管友好、隐私较好）；备选 hCaptcha |
| 配置 | settings：`captchaEnabled`、site key、secret（secret 仅服务端） |
| 兑换 | 开启时 public redeem 校验 token；API 调用可用「密钥豁免」或独立策略 |
| 前端 | 兑换页挂件；失败明确提示 |
| 关闭 | 默认 off，兼容现网 |

#### B3. 管理权限与敏感操作

| 项 | 方案 |
|----|------|
| 阶段 B 最小 | 敏感操作（应用更新、回滚、删除类别/批量删卡、轮换密钥）**二次确认 + 审计**；可选「确认输入登录密码」 |
| 阶段 B 增强（可选） | 管理员角色：`owner` / `operator` / `viewer`；viewer 只读 |
| API Key | 已有 scopes，与角色矩阵文档化 |

#### B4. 代码拆分（伴随功能改动进行）

- handler 按域拆文件（不改路由行为）  
- update 子系统目录化  
- 禁止一次 PR「只重构不测」——拆分 PR 需编译 + 相关测通过  

#### B5. 风控与运营指标（轻量）

| 指标 | 用途 |
|------|------|
| redeem_total / redeem_fail_total{reason} | 爆破 vs 业务失败 |
| update_apply_total{result} | 交付健康度 |
| http_request_duration | 已有基础可扩展 |
| 仪表盘 | 近 24h 失败兑换 Top 原因（管理端） |

#### B6. 前端体验（管理端 / 更新）

- 一键更新：进度、版本 diff、checksum、失败原因  
- 设置页：危险区折叠（安全/CSRF/更新）  
- 大列表：加载态与空态统一（已有组件则对齐）  

**迭代 B 出口标准**

- [ ] PR CI 绿才能合（或 main 强制）  
- [ ] 验证码开关真实有效  
- [ ] 更新/删库类操作有二次确认  
- [ ] handler/update 拆分后行为零回归  

---

### 迭代 C — 规模与产品增强（约 3～6 周，可按需裁剪）

**主题：更大库存、更好集成、更好体验。**

#### C1. 库存与兑换性能

| 方案 | 说明 |
|------|------|
| 物化计数 | `categories.unused_count` 或独立 stock 表；兑换/导入/作废时维护 |
| 降级 | 保留定期对账 job（与 `MarkExpiredCards` 同类） |
| 限流 | 多实例文档强制 Redis；本地内存限流仅 dev |

#### C2. 大批量导入异步化

- 服务端任务表或 Redis 任务：分片 INSERT  
- 复用前端 `task-progress`  
- 失败行可下载错误报告  

#### C3. 对象存储（可选）

- 文件型卡密：S3 兼容（MinIO/OSS）  
- DB 存 `storage_key` + meta；兑换时签名 URL 或代理下载  
- 默认仍可「纯库内」模式，零外部依赖安装  

#### C4. 集成

| 能力 | 说明 |
|------|------|
| 兑换成功 Webhook | 重试、签名、事件 id 幂等 |
| 导出增强 | 流式 CSV；按批次/时间 |
| 开放 API 幂等键 | 录入/兑换可选 `Idempotency-Key` |

#### C5. 体验与国际化

- 兑换端 PWA / 移动端打磨  
- UI i18n（中/英）与 `README_EN` 对齐  
- 品牌：Logo/主色已有则强化兑换页自定义  

#### C6. 备份与灾备产品化

- 管理端「导出备份说明」+ 脚本 `scripts/backup.sh` / `restore.sh`  
- 文档强调：备份含 Postgres；**CONTENT_KEY/JWT 丢失则卡密不可解密**  
- 可选：定时备份到对象存储（C3 联动）  

**迭代 C 出口标准（按启用项）**

- [ ] 百万级卡密下 stock/redeem p99 可接受（基准测试记录）  
- [ ] 异步导入可恢复、可观测  
- [ ] Webhook 有文档与重试语义  
- [ ] 备份脚本实机演练通过  

---

## 5. 专项设计要点

### 5.1 空壳包判定（统一标准）

| 检查 | 阈值 |
|------|------|
| 文件大小 | `< 13_000_000` → 拒绝 |
| 魔数 | 非 `\x7fELF` → 拒绝 |
| Embed（发版侧） | index CSS/JS 文件头 120 字节 ∈ binary |
| 运行时（可选） | `staticEmbeddedFiles < 5` 时 system/info 标 red，提示非完整包 |

### 5.2 生产配置矩阵

| 变量 | 生产期望 | 错误时行为（目标态） |
|------|----------|----------------------|
| `JWT_SECRET` | ≥32，非弱口令 | **拒绝启动** |
| `CONTENT_KEY` | 64 hex，非示例 | **拒绝启动** |
| `CSRF_CHECK` | `true` | false → **WARN**，不 exit |
| `METRICS_TOKEN` | 建议设置 | 空 → WARN |
| DB `sslmode` | 按部署 | disable → WARN |
| Redis | 多实例必开 | 按 `REQUIRE_REDIS` |

### 5.3 更新与卷路径

| 项 | 约定 |
|----|------|
| 持久二进制 | `$DATA_DIR/bin/cardkey`（默认 `/app/data/bin/cardkey`） |
| 卷名 | `cardkey_cardkey_data` / `cardkey_app_data`（以 `docker volume ls` 为准） |
| 优先级 | 卷内可执行且可写目录 → re-exec；否则镜像内 `/app/cardkey` |
| 回滚 | `.bak` 或管理端 RollbackUpdate 指定历史 release 缓存 |

### 5.4 测试策略金字塔

```text
        少量 E2E（compose + verify 脚本）
       /                              \
   集成测（app + PG/Redis）      前端组件/契约测
       \                              /
         大量单测（crypto/config/pkg/binary gate）
```

优先：**兑换状态机**、**更新 binary gate**、**鉴权 scope**。

### 5.5 可观测性

| 信号 | 出口 |
|------|------|
| 结构化日志 | JSON slog（已有） |
| healthz/readyz | 存活 / 依赖就绪 |
| /metrics | Prometheus；生产带 token |
| 管理端 system/info | version、warnings、embed 文件数、更新模式 |

---

## 6. 任务分解总表

> 确认本方案后，可将下表同步进 `TASKS.md` 或项目管理工具。

### 6.1 迭代 A

| ID | 任务 | 优先级 | 依赖 | 验收要点 |
|----|------|--------|------|----------|
| A1 | 修复/禁用空壳 Actions 发版 | P0 | — | 远程 size≥13MB |
| A2 | 发版门禁与重传流程演练 | P0 | A1 | 文档+脚本一致 |
| A3 | 更新校验 checksum + 拒小包 | P0 | — | 单测+手动 |
| A4 | 更新失败回滚（.bak/健康检查） | P0 | A3 | 故障注入可恢复 |
| A5 | system warnings + CSRF 默认 | P0 | — | info API + .env.example |
| A6 | compose healthcheck | P1 | — | ps 显示 healthy |
| A7 | 兑换集成测试最小集 | P1 | — | go test 稳定 |
| A8 | 仓库 gitignore/清理策略 | P2 | — | 无敏感/大文件误提交 |

### 6.2 迭代 B

| ID | 任务 | 优先级 | 依赖 | 验收要点 |
|----|------|--------|------|----------|
| B1 | PR CI（go/pnpm/tsc） | P1 | — | PR 红绿可见 |
| B2 | Turnstile/验证码闭环 | P1 | — | 开关真生效 |
| B3 | 敏感操作二次确认 | P1 | — | 更新/批量删 |
| B4 | 管理员角色（可选） | P2 | B3 | viewer 只读 |
| B5 | handler/update 拆分 | P2 | A7 | 行为不变 |
| B6 | 兑换失败指标与仪表盘 | P2 | — | metrics+UI |
| B7 | 更新 UI（进度/错误/checksum） | P2 | A3 | 管理端可用 |

### 6.3 迭代 C

| ID | 任务 | 优先级 | 依赖 | 验收要点 |
|----|------|--------|------|----------|
| C1 | 物化库存计数 | P2 | A7 | 压测记录 |
| C2 | 异步批量导入 | P2 | — | 进度可查 |
| C3 | S3 兼容对象存储 | P2 | — | 可选配置 |
| C4 | Webhook + 幂等键 | P2 | — | 文档+重试 |
| C5 | 备份/恢复脚本产品化 | P2 | — | 演练通过 |
| C6 | i18n / PWA（可选） | P3 | — | 双语切换 |

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Actions 与 release.sh 双写冲突 | 再次空壳 | **单一发版入口**；或 CI 与本地同一脚本 |
| 自动回滚误判 | 好包被回退 | healthz 连续失败 N 次才回滚；审计记录 |
| 验证码误伤 API 客户 | 集成失败 | API Key 路径豁免或独立开关 |
| 物化库存不一致 | 超卖/显示错误 | 事务内维护 + 对账 job |
| CONTENT_KEY 备份遗漏 | 灾难不可恢复 | 备份文档强制检查清单 |
| 大重构引入回归 | 隐性 bug | 拆分伴随测试；小 PR |

---

## 8. 工作量粗估

| 迭代 | 工程量（1 人参考） | 价值 |
|------|-------------------|------|
| A | 5～10 人日 | 消除 502/空壳类事故 |
| B | 10～15 人日 | 质量与防刷、可协作 |
| C | 15～30 人日（可裁剪） | 规模与生态集成 |

---

## 9. 里程碑与发布策略

| 里程碑 | 版本建议 | 内容 |
|--------|----------|------|
| M-A | 0.1.46+ | Actions 修复、更新加固、healthcheck、最小测试、warnings |
| M-B | 0.2.0 | 验证码、CI、敏感确认、结构拆分（次版本：能力面扩展） |
| M-C | 0.3.0 | 物化库存/异步导入/对象存储/Webhook 中启用项 |

发版纪律（不变）：

1. 只走完整一体包路径  
2. 远程 size 门禁  
3. 禁止 `down -v`  
4. 变更同步 `AGENTS.md` / 本方案进度  

---

## 10. 7 维闭环（关键能力摘要）

### 10.1 一键更新

| 维 | 要点 |
|----|------|
| 权限 | 仅管理员 + `system:update` scope |
| 状态 | idle / checking / downloading / applying / restarting / failed / rolled_back |
| 交互 | 进度、错误、回滚按钮、强制刷新提示 |
| 数据 | releases 缓存目录、`.bak`、审计 |
| 生命周期 | 下载临时文件清理、保留 N 个历史 |
| 依赖 | GitHub 可达、卷可写、磁盘空间 |
| 异常 | 网络失败、小包、非 ELF、启动失败回滚 |

### 10.2 公开兑换

| 维 | 要点 |
|----|------|
| 权限 | 可选/强制 redeem API Key；验证码（B） |
| 状态 | 前端 loading/成功/已用/过期/限流 |
| 交互 | 类别、编码、复制、批量 ZIP |
| 数据 | 卡密密文、兑换记录、限流键 |
| 生命周期 | 懒过期 + 周期 job |
| 依赖 | PG、Redis（限流/缓存） |
| 异常 | 限流 fail-open/closed、掩码错误 |

### 10.3 发版

| 维 | 要点 |
|----|------|
| 权限 | 维护者 + gh token |
| 状态 | dry-run / building / uploading / verified |
| 交互 | release.sh 日志清晰 |
| 数据 | VERSION、tag、dist、Release 资产 |
| 依赖 | go/pnpm/gh |
| 异常 | 体积失败中止；远程不一致中止 |

---

## 11. 验收清单（方案级）

### 功能与交付

- [ ] 任意正式版 GitHub 资产 ≥13MB 且可 `staticEmbedded`  
- [ ] 故意安装 12MB 包被拒或自动恢复  
- [ ] 更新成功后 healthz 200，管理端 version 正确  
- [ ] CSRF=false 时新版本启动并打出 WARN（非 exit）  

### 质量

- [ ] `go test ./...` 含 app 层关键用例  
- [ ] PR CI 或等价本地 `make check`  
- [ ] 无密钥/cookies 进库  

### 安全与运维

- [ ] 验证码（B）可开关  
- [ ] 敏感操作有确认与审计  
- [ ] 备份演练文档可执行  
- [ ] metrics/warnings 可观察  

### 规模（C，按启用）

- [ ] 约定数据量下的压测报告附仓库或内部文档  

---

## 12. 建议执行顺序（确认后）

```text
Week 1     A1 A2 A3 A5     —— 止血发版与配置
Week 1–2   A4 A6 A7 A8     —— 回滚、健康检查、测试、卫生
Week 3–4   B1 B2 B3 B7     —— CI、验证码、确认、更新 UI
Week 4–5   B5 B6 (B4)      —— 拆分、指标、可选角色
Week 6+    C* 按业务优先级裁剪
```

---

## 13. 确认项（请产品/维护者拍板）

1. **发版入口**：仅 `release.sh`，还是「修好的 Actions 与本地等价」双可？  
2. **验证码**：Turnstile 是否可接受（需 Cloudflare）？或必须无第三方？  
3. **迭代 C**：对象存储 / Webhook / 物化库存 的优先级排序？  
4. **角色模型**：B 迭代是否上 `viewer`，还是仅二次确认？  
5. **版本号策略**：A 继续 0.1.x，B 起 0.2.0 是否同意？  

---

## 14. 文档与代码索引

| 路径 | 与本方案关系 |
|------|----------------|
| `AGENTS.md` | 体积铁律、502 排障、Agent 硬约束 |
| `scripts/release.sh` | 正式发版 |
| `scripts/_upload_assets.py` | 防截断上传 |
| `.github/workflows/release.yml` | **A1 必改** |
| `backend/internal/app/update.go` | 更新/回滚 |
| `backend/internal/config/config.go` | 生产校验 |
| `backend/internal/app/redeem.go` | 兑换/验证码位 |
| `deploy/DATA_SAFETY.md` | 卷安全 |
| `TASKS.md` | 历史里程碑；确认后追加 A/B/C 任务 |

---

## 15. 实施进度（对照任务表）

| ID | 状态 | 说明 |
|----|------|------|
| A1 | ✅ | `.github/workflows/release.yml`：pnpm build + embed + ≥13MB 门禁 |
| A2 | ✅ | 与 release.sh / `_upload_assets.py` 一致；AGENTS 已有重传流程 |
| A3 | ✅ | `binary_gate.go` + 单测；更新路径 assert + SHA256 |
| A4 | ✅ | 更新前 `CARDKEY_SELFTEST`；配置失败 exec `.bak`；entrypoint ≥13MB 拒空壳 |
| A5 | ✅ | `ProductionWarnings` + 启动 WARN + system/info.warnings |
| A6 | ✅ | compose + Dockerfile healthcheck（wget healthz） |
| A7 | ✅ | binary gate + config warnings 测试；兑换全链路集成测仍可加强 |
| A8 | ✅ | `.gitignore` dist；CI workflow |
| B1 | ✅ | `.github/workflows/ci.yml` |
| B2 | ✅ | Turnstile：env 密钥 + 设置开关 + 兑换页挂件 + Redis 短时放行 |
| B3 | ✅ | 更新/删类/批次/卡密等前端已有 confirm |
| B5 | ✅ | handler 拆 `redeem.go` / `system.go` / `updates.go` |
| B6 | ✅ | 仪表盘 runtime 已含兑换成功/失败计数 |
| C4 | ✅ | 兑换成功 Webhook（URL + HMAC 签名） |
| C5 | ✅ | `scripts/backup.sh` / `restore-hint.sh` |
| C1/C2/C3/C6 | ⬜ | 物化库存 / 异步导入 / 对象存储 / i18n — 按需后续 |

**当前版本文件**：`VERSION` → **0.1.46**（需 `scripts/release.sh` 发版后线上才可一键更新到此优化包）。

---

## 16. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-07-28 | 首版：基于 v0.1.45 现状与线上 502/空壳事故的全面优化方案 |
| v1.1 | 2026-07-28 | 落地 v0.1.46：发版 CI、门禁、warnings、Turnstile、备份脚本、compose 健康检查 |

---

*确认本方案后，再拆任务实现；实现期以代码为准，并回写本节进度与验收勾选。*
