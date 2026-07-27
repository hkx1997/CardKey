# 数据安全说明（必读）

## `git pull` **不会**清空数据库

代码拉取只改仓库文件。PostgreSQL 数据在 Docker **命名卷**里：

| 卷名 | 用途 |
|------|------|
| `cardkey_postgres_data` | 业务库（卡密、兑换、管理员等） |
| `cardkey_app_data` | 上传文件等 |

与仓库路径、是否 `git pull` **无关**。

## 真正会丢数据的操作

```bash
docker compose down -v          # 删除 compose 声明的卷 → 库没了
docker volume rm cardkey_postgres_data
docker system prune --volumes   # 可能删未使用卷
```

安装/升级脚本已避免 `down -v`。**永远不要**把 `-v` 加在日常升级命令上。

## 推荐升级方式

```bash
# 方式 A：安全脚本
bash scripts/upgrade.sh

# 方式 B：手动（同样不删卷）
git pull
docker compose up -d --build
```

## 为何有人感觉「拉代码就重置了」

常见原因：

1. 执行过 `docker compose down -v` 或重装脚本清了卷  
2. **换了目录/项目名** 且卷未固定名时，会挂上**新空卷**（旧数据还在旧卷里）  
3. 改了 `POSTGRES_USER` / `POSTGRES_DB` 后以为是空库（数据仍在旧库名下）  
4. 全新机器没有同步卷备份  

当前 `docker-compose.yml` 已使用**固定卷名** `cardkey_postgres_data` / `cardkey_app_data`，降低「换目录变空库」风险。

## 找回旧卷

```bash
docker volume ls | grep cardkey
# 若有旧匿名卷，可用临时容器把数据拷出或改 compose 挂载旧卷名
```

## 备份建议

```bash
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-$(date +%F).sql
```
