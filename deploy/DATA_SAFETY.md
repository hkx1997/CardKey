# 数据安全说明（必读）

## 结论

| 操作 | 会丢库吗？ |
|------|------------|
| `git pull` / 在线替换二进制 | **否** |
| `docker compose build` | **否** |
| `docker compose up -d` | **否**（**卷名正确时**） |
| `docker compose up -d --build` | **否**（**卷名正确时**） |
| `bash scripts/upgrade.sh` | **否**（推荐） |
| `docker compose down` | **否**（只停容器） |
| `docker compose down -v` | **是** ← 禁止 |
| 更换卷名 / 项目名导致挂上**新空卷** | **看起来像重置**（旧数据还在旧卷） |
| 安装向导勾选「演示数据」 | **否**，但会**写入** VIP/CDK 示例 |

## 为啥会出现「示例数据都进来了」

常见链路：

1. Compose 挂上了 **新的空 Postgres 卷**（不是删了旧数据）。  
2. 打开管理端 → **安装向导** 又走了一遍（或 env 创建了管理员）。  
3. 向导默认/勾选了「演示类别」→ 写入 VIP / CDK 示例卡密。  

**旧数据通常还在另一个 Docker volume 里**，没有被 `git pull` 或「在线更新」删除。

从 v0.1.14 起：

- **启动时不再自动灌演示数据**（即使类别表为空）。  
- 安装向导 **默认不勾选** 演示数据。  

## 为何升级后像「重置了库」

几乎都是 **挂载了另一个空卷**，不是 SQL 被 DROP：

1. `docker-compose.yml` 里卷的 `name:` 改过（例如固定为 `cardkey_postgres_data`），Compose 会建**新卷**，旧数据仍在旧名卷。  
2. 换了部署目录且以前没固定 `name: cardkey`，project 前缀变了。  
3. 改过 `POSTGRES_USER` / `POSTGRES_DB`，连的是空库名。  
4. 执行了 `docker compose down -v` 或 `docker volume rm` / `prune --volumes`。

### 一键找回旧卷

```bash
cd /你的/cardkey目录
bash scripts/recover-volume.sh
# 或指定名字：
bash scripts/recover-volume.sh 旧卷完整名字
```

手动步骤：

```bash
docker volume ls | grep -iE 'cardkey|postgres'

# 假设旧卷叫 cardkey_cardkey_postgres_data 或目录名_postgres_data
# 写入 .env：
# POSTGRES_VOLUME_NAME=旧卷完整名字

docker compose up -d --force-recreate --no-deps postgres
docker compose up -d --no-deps cardkey
```

用体积更大、创建更早的卷优先尝试。

### 推荐升级（只动应用）

```bash
bash scripts/upgrade.sh
# 或指定版本
bash scripts/upgrade.sh v0.1.13
```

等价于：

```bash
docker compose up -d --no-recreate postgres redis
docker compose build cardkey
docker compose up -d --no-deps cardkey
```

**不要**日常使用：

```bash
docker compose down -v
docker volume rm ...
docker system prune --volumes
```

## 在线更新路径

容器内进程路径由 **`os.Executable()` 动态获取**（一般为 `/app/cardkey`）。  
`.env` 里请**删除**错误的：

```env
UPDATE_BINARY_PATH=/opt/cardkey/cardkey
UPDATE_RELEASES_DIR=/opt/cardkey/releases
```

留空即可。在线更新**只替换应用二进制并重启 cardkey 进程**，不碰 Postgres 卷。

## 备份（强烈建议）

```bash
# 读 .env 中的用户/库名
source .env 2>/dev/null || true
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-cardkey}" "${POSTGRES_DB:-cardkey}" > backup-$(date +%F).sql
```

恢复：

```bash
cat backup-YYYY-MM-DD.sql | docker compose exec -T postgres \
  psql -U "${POSTGRES_USER:-cardkey}" "${POSTGRES_DB:-cardkey}"
```
