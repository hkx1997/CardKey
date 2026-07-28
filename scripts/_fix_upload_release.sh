#!/usr/bin/env bash
# 用 gh api --input 流式上传，避免 Windows 下 gh release upload 截断大文件
set -euo pipefail
VER="${1:?version e.g. 0.1.41}"
TAG="v${VER}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist/release-${VER}"
cd "$DIST"

for f in cardkey-linux-amd64 cardkey-linux-arm64 checksums.txt; do
  test -f "$f" || { echo "missing $f" >&2; exit 1; }
done

AMD=$(wc -c < cardkey-linux-amd64 | tr -d ' ')
ARM=$(wc -c < cardkey-linux-arm64 | tr -d ' ')
echo "local amd64=$AMD arm64=$ARM"
if [[ "$AMD" -lt 13000000 || "$ARM" -lt 13000000 ]]; then
  echo "FAIL: local binaries too small (SPA not embedded)" >&2
  exit 1
fi

REL_ID=$(gh api "repos/hkx1997/CardKey/releases/tags/${TAG}" --jq .id)
echo "release id=$REL_ID"

# 删除已有资产
while read -r aid aname asize; do
  [[ -z "${aid:-}" ]] && continue
  echo "delete asset $aname id=$aid size=$asize"
  gh api -X DELETE "repos/hkx1997/CardKey/releases/assets/${aid}" >/dev/null || true
done < <(gh api "repos/hkx1997/CardKey/releases/tags/${TAG}" --jq '.assets[] | "\(.id) \(.name) \(.size)"')

upload_one() {
  local name="$1"
  local path="$2"
  local size
  size=$(wc -c < "$path" | tr -d ' ')
  echo "upload $name ($size bytes)..."
  gh api \
    --method POST \
    -H "Content-Type: application/octet-stream" \
    -H "Accept: application/vnd.github+json" \
    --input "$path" \
    "https://uploads.github.com/repos/hkx1997/CardKey/releases/${REL_ID}/assets?name=${name}" \
    --jq '{name: .name, size: .size}'
}

upload_one cardkey-linux-amd64 ./cardkey-linux-amd64
upload_one cardkey-linux-arm64 ./cardkey-linux-arm64
upload_one checksums.txt ./checksums.txt

echo "==> verify remote sizes"
gh api "repos/hkx1997/CardKey/releases/tags/${TAG}" --jq '.assets[] | "\(.name) \(.size)"'

REMOTE_AMD=$(gh api "repos/hkx1997/CardKey/releases/tags/${TAG}" --jq '.assets[] | select(.name=="cardkey-linux-amd64") | .size')
REMOTE_ARM=$(gh api "repos/hkx1997/CardKey/releases/tags/${TAG}" --jq '.assets[] | select(.name=="cardkey-linux-arm64") | .size')

echo "remote amd64=$REMOTE_AMD arm64=$REMOTE_ARM"
if [[ "$REMOTE_AMD" != "$AMD" || "$REMOTE_ARM" != "$ARM" ]]; then
  echo "FAIL: remote size mismatch" >&2
  exit 1
fi
echo "OK: ${TAG} full SPA binaries on GitHub"
echo "https://github.com/hkx1997/CardKey/releases/tag/${TAG}"
