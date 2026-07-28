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

echo "==> 构建前端（嵌入二进制，一键更新可刷新 UI）"
(
  cd frontend
  if command -v pnpm >/dev/null 2>&1; then
    VITE_API_MODE=http VITE_APP_VERSION="$VERSION" pnpm install --frozen-lockfile
    VITE_API_MODE=http VITE_APP_VERSION="$VERSION" pnpm build
  else
    echo "需要 pnpm 以构建前端并嵌入 Release 二进制" >&2
    exit 1
  fi
)
rm -rf backend/internal/webstatic/dist
# Windows Git Bash 上 cp -a dist/. 可能拷不全；Python shutil 更稳
python - <<'PY'
import re
import shutil
from pathlib import Path

src = Path("frontend/dist")
dst = Path("backend/internal/webstatic/dist")
if not (src / "index.html").is_file():
    raise SystemExit("frontend/dist/index.html missing")
if dst.exists():
    shutil.rmtree(dst)
shutil.copytree(src, dst)
assets = list((dst / "assets").glob("*")) if (dst / "assets").is_dir() else []
nfiles = sum(1 for p in dst.rglob("*") if p.is_file())
print(f"webstatic embed: files={nfiles} assets={len(assets)}")
if len(assets) < 5:
    raise SystemExit(f"embed assets too few ({len(assets)}); refuse broken SPA package")
index = (dst / "index.html").read_text(encoding="utf-8")
refs = re.findall(r"/assets/(index-[^\"']+\.(?:js|css))", index)
print("index asset refs:", refs)
if len(refs) < 2:
    raise SystemExit("index.html missing js/css asset refs")
PY

test -f backend/internal/webstatic/dist/index.html || { echo "frontend dist 缺少 index.html" >&2; exit 1; }
test -d backend/internal/webstatic/dist/assets || { echo "frontend dist 缺少 assets/" >&2; exit 1; }
# 主 CSS/JS 路径，用于校验已编入二进制
CSS_FILE=$(ls backend/internal/webstatic/dist/assets/index-*.css 2>/dev/null | head -1)
JS_FILE=$(ls backend/internal/webstatic/dist/assets/index-*.js 2>/dev/null | head -1)
test -n "$CSS_FILE" && test -n "$JS_FILE" || { echo "缺少 index-*.css/js" >&2; exit 1; }
echo "embed markers: CSS=$CSS_FILE JS=$JS_FILE"

echo "==> 构建 linux-amd64 / linux-arm64（含嵌入 SPA + migrations）"
(
  cd backend
  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="$LDFLAGS" -o "$DIST/cardkey-linux-amd64" ./cmd/cardkey
  CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="$LDFLAGS" -o "$DIST/cardkey-linux-arm64" ./cmd/cardkey
)

echo "==> 校验二进制已嵌入 SPA（防止发空壳 exe）"
verify_bin() {
  local bin="$1"
  local sz
  sz=$(wc -c <"$bin" | tr -d ' ')
  # 无 SPA 的 exe 约 11–12MB；含完整 SPA 通常 >13MB
  if [[ "${sz:-0}" -lt 13000000 ]]; then
    echo "FAIL: $bin 过小 (${sz} bytes)，疑似未嵌入前端 assets" >&2
    return 1
  fi
  python - "$bin" "$CSS_FILE" "$JS_FILE" <<'PY'
import sys
from pathlib import Path
bin_path, css_path, js_path = sys.argv[1], sys.argv[2], sys.argv[3]
data = Path(bin_path).read_bytes()
css = Path(css_path).read_bytes()[:120]
js = Path(js_path).read_bytes()[:120]
ok = True
if css not in data:
    print("FAIL: CSS payload missing in", bin_path, file=sys.stderr)
    ok = False
if js not in data:
    print("FAIL: JS payload missing in", bin_path, file=sys.stderr)
    ok = False
if b"index-" not in data:
    print("FAIL: no index- asset name in", bin_path, file=sys.stderr)
    ok = False
if not ok:
    sys.exit(1)
print("OK embed:", bin_path, "size", len(data))
PY
}
verify_bin "$DIST/cardkey-linux-amd64"
verify_bin "$DIST/cardkey-linux-arm64"

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
  echo "**界面一键更新（Docker）**：管理后台 → 版本号 → 检测更新 → 一键更新（下载 \`cardkey-linux-amd64/arm64\` 并重启）。"
  echo ""
  echo "**数据库迁移**：\`backend/migrations/*.sql\` 经 \`go:embed\` 打进二进制；替换重启后自动执行未应用迁移（幂等，不删库）。"
  echo ""
  echo "**前端 SPA**：\`frontend/dist\` 同样嵌入二进制；**一键更新换 exe 后 UI/CSS 一并更新**（不再依赖镜像里旧的 /app/static）。"
  echo ""
  echo "**命令行：**"
  echo '```bash'
  echo "bash scripts/upgrade.sh $TAG"
  echo "# 或"
  echo "git fetch --tags && git checkout $TAG && docker compose build cardkey && docker compose up -d --no-deps cardkey"
  echo '```'
  echo ""
  echo "Release 附带 **Linux** 二进制（amd64/arm64，含 SPA+迁移）供在线更新；勿使用 \`docker compose down -v\`。"
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

echo "==> GitHub Release（先建空 Release，再用 API 流式上传，避免 Windows gh 截断 ~12MB 空壳）"
gh release create "$TAG" \
  --title "CardKey $TAG" \
  --notes-file "$NOTES" \
  --latest

# Python 直传 uploads.github.com，体积与本地一致
python "$ROOT/scripts/_upload_assets.py" "$VERSION"

echo "==> 校验远程资产体积 + SPA 嵌入"
REMOTE_SZ=$(gh api "repos/hkx1997/CardKey/releases/tags/${TAG}" --jq '.assets[] | select(.name=="cardkey-linux-amd64") | .size')
LOCAL_SZ=$(wc -c <"$DIST/cardkey-linux-amd64" | tr -d ' ')
echo "local=$LOCAL_SZ remote=$REMOTE_SZ"
if [[ "$LOCAL_SZ" != "$REMOTE_SZ" ]]; then
  echo "FAIL: remote size mismatch after API upload" >&2
  exit 1
fi
if [[ "$REMOTE_SZ" -lt 13000000 ]]; then
  echo "FAIL: remote binary too small (empty shell)" >&2
  exit 1
fi
# API 体积已对齐时再可选回拉（网络差时不阻断发版）
VERIFY_DIR="$(mktemp -d)"
trap 'rm -rf "$VERIFY_DIR"' EXIT
if gh release download "$TAG" -p cardkey-linux-amd64 -D "$VERIFY_DIR" --clobber 2>/dev/null; then
  python - "$VERIFY_DIR/cardkey-linux-amd64" "$CSS_FILE" <<'PY'
import sys
from pathlib import Path
data = Path(sys.argv[1]).read_bytes()
css = Path(sys.argv[2]).read_bytes()[:120]
if css not in data:
    raise SystemExit("FAIL: re-downloaded GitHub binary missing CSS embed")
print("OK GitHub asset redownload verified:", len(data), "bytes")
PY
else
  echo "WARN: redownload skipped (network); API size already matched local"
fi

rm -f "$NOTES"
echo "OK: https://github.com/hkx1997/CardKey/releases/tag/$TAG"
