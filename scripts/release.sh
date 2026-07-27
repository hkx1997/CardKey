#!/usr/bin/env bash
# 正式发版（轻量）：校验 VERSION → 推送 main → 打 tag → 创建 GitHub Release 说明
# 不构建、不上传各平台二进制（Docker 部署用源码/镜像升级即可）
#
# 用法：
#   bash scripts/release.sh           # 按 VERSION 文件发版
#   bash scripts/release.sh 0.1.7     # 先写入 VERSION 再发版
#   bash scripts/release.sh --dry-run
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DRY=0
VER_ARG=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    -*) echo "unknown flag: $a" >&2; exit 1 ;;
    *) VER_ARG="$a" ;;
  esac
done

if [[ -n "$VER_ARG" ]]; then
  echo "$VER_ARG" > VERSION
fi

VERSION="$(tr -d ' \t\r\n' < VERSION)"
if [[ -z "$VERSION" ]]; then
  echo "VERSION file empty" >&2
  exit 1
fi
TAG="v${VERSION}"

if ! command -v gh >/dev/null 2>&1; then
  echo "需要 GitHub CLI: https://cli.github.com/" >&2
  exit 1
fi

dirty="$(git status --porcelain)"
if [[ -n "$dirty" ]]; then
  # 允许仅 VERSION 未提交；其它改动须先提交
  if echo "$dirty" | grep -vE '^[ MARC][ MD] VERSION$|^[MARC]  VERSION$|^ M VERSION$|^M  VERSION$|^M VERSION$' | grep -q .; then
    echo "工作区有未提交改动，请先提交再发版：" >&2
    git status --short >&2
    exit 1
  fi
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "本地 tag $TAG 已存在" >&2
  exit 1
fi
if git ls-remote --tags origin "refs/tags/$TAG" 2>/dev/null | grep -q .; then
  echo "远端 tag $TAG 已存在" >&2
  exit 1
fi

echo "==> 版本 $VERSION  tag $TAG（无二进制资产）"

if ! git diff --quiet VERSION 2>/dev/null || ! git diff --cached --quiet VERSION 2>/dev/null; then
  git add VERSION
  git commit -m "chore: bump version to $VERSION" || true
fi

NOTES="$(mktemp)"
{
  echo "## CardKey $TAG"
  echo ""
  echo "### 升级（Docker 推荐）"
  echo ""
  echo '```bash'
  echo "cd /path/to/CardKey"
  echo "git fetch --tags && git checkout $TAG"
  echo "docker compose up -d --build"
  echo "# 或：bash scripts/upgrade.sh"
  echo '```'
  echo ""
  echo "本 Release **不附带**各平台二进制包；数据卷请勿使用 \`docker compose down -v\`。"
  echo ""
  echo "### 变更摘要"
  echo ""
  git log -12 --pretty=format:'- %s (%h)' "$(git describe --tags --abbrev=0 2>/dev/null || echo HEAD~15)"..HEAD 2>/dev/null \
    || git log -8 --pretty=format:'- %s (%h)'
  echo ""
} >"$NOTES"

if [[ "$DRY" == "1" ]]; then
  echo "[dry-run] 将创建 tag $TAG，不构建二进制"
  cat "$NOTES"
  rm -f "$NOTES"
  exit 0
fi

echo "==> push main"
git push origin HEAD:main

echo "==> tag $TAG"
git tag -a "$TAG" -m "CardKey $TAG"
git push origin "$TAG"

echo "==> GitHub Release（仅说明，无 assets）"
gh release create "$TAG" \
  --title "CardKey $TAG" \
  --notes-file "$NOTES"

rm -f "$NOTES"
echo ""
echo "OK: https://github.com/hkx1997/CardKey/releases/tag/$TAG"
