# 数据安全说明（必读）

## 结论

| 操作 | 会丢库吗？ |
|------|------------|
| `git pull` | **否** |
| `docker compose build` | **否** |
| `docker compose up -d` | **否**（卷正确时） |
| `docker compose up -d --build` | **否**（卷正确时） |
| `bash scripts/upgrade.sh` | **否**（推荐） |
| `docker compose down` | **否**（只停容器） |
| `docker compose down -v` | **是** ← 禁止 |
| 更换卷名 / 项目名导致挂上**新空卷** | **看起来像丢了**（旧数据还在旧卷） |

## 为何 `up -d --build` 有时像「重置了库」

常见不是删了数据，而是 **挂载了另一个空卷**：

1. `docker-compose.yml` 里卷的 `name:` 改过（例如改成 `cardkey_postgres_data`），Compose 会建**新卷**，旧数据仍在旧名卷里。  
2. 换了目录且未固定 `name: cardkey`，project 前缀变了。  
3. 改过 `POSTGRES_USER` / `POSTGRES_DB`，连的是空库名，数据在旧库里。

### 找回旧卷

```bash
docker volume ls | grep -i cardkey
# 或
docker volume ls | grep postgres

# 假设旧卷叫 cardkey_cardkey_postgres_data 或类似名字，写入 .env：
echo 'POSTGRES_VOLUME_NAME=旧卷完整名字' >> .env
docker compose up -d postgres
```

### 推荐升级（只动应用）

```bash
bash scripts/upgrade.sh
# 或指定版本
bash scripts/upgrade.sh v0.1.11
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

留空即可。

## 备份

```bash
docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-$(date +%F).sql
```
