#!/usr/bin/env bash
# 正式发版：VERSION → tag → 构建 Linux 服务器二进制（供 Docker 一键更新）→ GitHub Release
# 仅 linux-amd64 / linux-arm64（不附带 Windows/macOS 包）
#
# 用法：
#   bash scripts/release.sh
#   bash scripts/release.sh 0.1.12
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

command -v gh >/dev/null || { echo "需要 gh CLI" >&2; exit 1; }
command -v go >/dev/null || { echo "需要 Go" >&2; exit 1; }

dirty="$(git status --porcelain)"
if [[ -n "$dirty" ]]; then
  if echo "$dirty" | grep -vE '^[ MARC][ MD] VERSION$|^[MARC]  VERSION$|^ M VERSION$|^M  VERSION$|^M VERSION$' | grep -q .; then
    echo "工作区有未提交改动，请先提交：" >&2
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

echo "==> 版本 $VERSION  tag $TAG（Linux 服务器资产）"

if ! git diff --quiet VERSION 2>/dev/null || ! git diff --cached --quiet VERSION 2>/dev/null; then
  git add VERSION
  git commit -m "chore: bump version to $VERSION" || true
fi

DIST="$ROOT/dist/release-$VERSION"
rm -rf "$DIST"
mkdir -p "$DIST"
COMMIT="$(git rev-parse --short HEAD)"
BT="$(date -u +%Y-%m-%dT%H:%MZ 2>/dev/null || echo unknown)"
LDFLAGS="-s -w -X github.com/cardkey/cardkey/internal/version.Version=${VERSION} -X github.com/cardkey/cardkey/internal/version.Commit=${COMMIT} -X github.com/cardkey/cardkey/internal/version.BuildTime=${BT}"

echo "==> 构建 linux-amd64 / linux-arm64"
(
  cd backend
  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="$LDFLAGS" -o "$DIST/cardkey-linux-amd64" ./cmd/cardkey
  CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="$LDFLAGS" -o "$DIST/cardkey-linux-arm64" ./cmd/cardkey
)

echo "==> checksums"
(
  cd "$DIST"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum cardkey-linux-* > checksums.txt
  else
    shasum -a 256 cardkey-linux-* > checksums.txt
  fi
  cat checksums.txt
)

NOTES="$(mktemp)"
{
  echo "## CardKey $TAG"
  echo ""
  echo "### 升级"
  echo ""
  echo "**界面一键更新（Docker）**：管理后台 → 版本号 → 检测更新 → 一键更新（下载 \`cardkey-linux-amd64/arm64\` 并重启容器）。"
  echo ""
  echo "**命令行：**"
  echo '```bash'
  echo "bash scripts/upgrade.sh $TAG"
  echo "# 或"
  echo "git fetch --tags && git checkout $TAG && docker compose build cardkey && docker compose up -d --no-deps cardkey"
  echo '```'
  echo ""
  echo "Release 附带 **Linux** 二进制（amd64/arm64）供在线更新；勿使用 \`docker compose down -v\`。"
  echo ""
  echo "### 变更"
  echo ""
  git log -10 --pretty=format:'- %s (%h)' "$(git describe --tags --abbrev=0 2>/dev/null || echo HEAD~12)"..HEAD 2>/dev/null \
    || git log -8 --pretty=format:'- %s (%h)'
  echo ""
} >"$NOTES"

if [[ "$DRY" == "1" ]]; then
  echo "[dry-run] 产物: $DIST"
  cat "$NOTES"
  rm -f "$NOTES"
  exit 0
fi

echo "==> push main + tag"
git push origin HEAD:main
git tag -a "$TAG" -m "CardKey $TAG"
git push origin "$TAG"

echo "==> GitHub Release + Linux 资产"
gh release create "$TAG" \
  --title "CardKey $TAG" \
  --notes-file "$NOTES" \
  "$DIST/cardkey-linux-amd64" \
  "$DIST/cardkey-linux-arm64" \
  "$DIST/checksums.txt"

rm -f "$NOTES"
echo "OK: https://github.com/hkx1997/CardKey/releases/tag/$TAG"
