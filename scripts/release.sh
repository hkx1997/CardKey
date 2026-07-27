#!/usr/bin/env bash
# 正式发版：校验 VERSION → 打 tag → 构建多平台二进制 → 创建 GitHub Release
# 用法：
#   bash scripts/release.sh           # 按 VERSION 文件发版
#   bash scripts/release.sh 0.1.5     # 先写入 VERSION 再发版
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
if ! command -v go >/dev/null 2>&1; then
  echo "需要 Go toolchain" >&2
  exit 1
fi

# 工作区须干净（允许仅 VERSION 待提交时由本脚本提交）
if [[ -n "$(git status --porcelain | grep -v '^ M VERSION$' | grep -v '^M  VERSION$' | grep -v '^M VERSION$' || true)" ]]; then
  # 若只有 VERSION 变更可继续；有其他改动则中止
  dirty="$(git status --porcelain)"
  if echo "$dirty" | grep -vE '^[ M][ M] VERSION$' | grep -q .; then
    echo "工作区有未提交改动，请先提交再发版：" >&2
    git status --short >&2
    exit 1
  fi
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "本地 tag $TAG 已存在" >&2
  exit 1
fi
if git ls-remote --tags origin "refs/tags/$TAG" | grep -q .; then
  echo "远端 tag $TAG 已存在" >&2
  exit 1
fi

echo "==> 版本 $VERSION  tag $TAG"

# 确保 VERSION 已提交
if ! git diff --quiet VERSION 2>/dev/null || ! git diff --cached --quiet VERSION 2>/dev/null; then
  git add VERSION
  git commit -m "chore: bump version to $VERSION" || true
fi

# 同步 README 无要求；记录 CHANGELOG 片段
NOTES="$(mktemp)"
{
  echo "## CardKey $TAG"
  echo ""
  echo "### 安装 / 升级"
  echo ""
  echo '```bash'
  echo "git fetch --tags && git checkout $TAG"
  echo "# 或 Docker："
  echo "git pull && docker compose up -d --build"
  echo '```'
  echo ""
  echo "### 变更"
  echo ""
  git log -15 --pretty=format:'- %s (%h)' "$(git describe --tags --abbrev=0 2>/dev/null || echo HEAD~20)"..HEAD 2>/dev/null || git log -10 --pretty=format:'- %s (%h)'
  echo ""
  echo ""
  echo "### 校验"
  echo ""
  echo "下载后请核对 checksums.txt 中的 SHA256。"
} >"$NOTES"

DIST="$ROOT/dist/release-$VERSION"
rm -rf "$DIST"
mkdir -p "$DIST"

build_one() {
  local goos="$1" goarch="$2" out="$3"
  echo "  build $out"
  (
    cd backend
    CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" go build \
      -ldflags="-s -w -X github.com/cardkey/cardkey/internal/version.Version=${VERSION} -X github.com/cardkey/cardkey/internal/version.Commit=$(git rev-parse --short HEAD) -X github.com/cardkey/cardkey/internal/version.BuildTime=$(date -u +%Y-%m-%dT%H:%MZ)" \
      -o "$DIST/$out" ./cmd/cardkey
  )
}

echo "==> 构建二进制"
build_one linux amd64 "cardkey-linux-amd64"
build_one linux arm64 "cardkey-linux-arm64"
build_one darwin amd64 "cardkey-darwin-amd64"
build_one darwin arm64 "cardkey-darwin-arm64"
build_one windows amd64 "cardkey-windows-amd64.exe"

echo "==> checksums"
(
  cd "$DIST"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum cardkey-* > checksums.txt
  else
    # Windows Git Bash / macOS
    for f in cardkey-*; do
      if command -v shasum >/dev/null 2>&1; then
        echo "$(shasum -a 256 "$f" | awk '{print $1}')  $f"
      else
        echo "$(certutil -hashfile "$f" SHA256 2>/dev/null | awk 'NR==2 {print tolower($0)}')  $f"
      fi
    done > checksums.txt
  fi
  cat checksums.txt
)

if [[ "$DRY" == "1" ]]; then
  echo "[dry-run] 跳过 push/tag/release"
  echo "产物目录: $DIST"
  cat "$NOTES"
  rm -f "$NOTES"
  exit 0
fi

echo "==> push main"
git push origin HEAD:main

echo "==> tag $TAG"
git tag -a "$TAG" -m "CardKey $TAG"
git push origin "$TAG"

echo "==> GitHub Release"
gh release create "$TAG" \
  --title "CardKey $TAG" \
  --notes-file "$NOTES" \
  "$DIST"/cardkey-linux-amd64 \
  "$DIST"/cardkey-linux-arm64 \
  "$DIST"/cardkey-darwin-amd64 \
  "$DIST"/cardkey-darwin-arm64 \
  "$DIST"/cardkey-windows-amd64.exe \
  "$DIST"/checksums.txt

rm -f "$NOTES"
echo ""
echo "OK: https://github.com/hkx1997/CardKey/releases/tag/$TAG"
