"""Upload full release assets via GitHub API (avoids Windows gh path truncation)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path


def gh_token() -> str:
    # Prefer env
    for k in ("GH_TOKEN", "GITHUB_TOKEN"):
        v = os.environ.get(k, "").strip()
        if v:
            return v
    # gh auth token
    r = subprocess.run(
        ["gh", "auth", "token"],
        capture_output=True,
        text=True,
        check=False,
    )
    tok = (r.stdout or "").strip()
    if not tok:
        raise SystemExit("no github token (gh auth token failed)")
    return tok


def main() -> None:
    ver = sys.argv[1] if len(sys.argv) > 1 else "0.1.41"
    tag = f"v{ver}"
    root = Path(__file__).resolve().parents[1]
    dist = root / f"dist/release-{ver}"
    files = [
        "cardkey-linux-amd64",
        "cardkey-linux-arm64",
        "checksums.txt",
    ]
    for f in files:
        p = dist / f
        if not p.is_file():
            raise SystemExit(f"missing {p}")
        print(f"local {f}={p.stat().st_size}")
        if f.startswith("cardkey-") and p.stat().st_size < 13_000_000:
            raise SystemExit(f"local {f} too small (empty shell?)")

    token = gh_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "CardKey-Release-Uploader",
    }

    req = urllib.request.Request(
        f"https://api.github.com/repos/hkx1997/CardKey/releases/tags/{tag}",
        headers=headers,
    )
    with urllib.request.urlopen(req) as resp:
        rel = json.load(resp)
    rel_id = rel["id"]
    print(f"release id={rel_id}")

    for a in rel.get("assets") or []:
        aid, name, size = a["id"], a["name"], a["size"]
        print(f"delete asset {name} id={aid} size={size}")
        dreq = urllib.request.Request(
            f"https://api.github.com/repos/hkx1997/CardKey/releases/assets/{aid}",
            method="DELETE",
            headers=headers,
        )
        try:
            with urllib.request.urlopen(dreq) as _:
                pass
        except urllib.error.HTTPError as e:
            if e.code not in (204, 404):
                print(f"  warn delete {name}: {e.code}")

    for name in files:
        path = dist / name
        data = path.read_bytes()
        print(f"upload {name} ({len(data)} bytes)...")
        url = (
            f"https://uploads.github.com/repos/hkx1997/CardKey/releases/"
            f"{rel_id}/assets?name={name}"
        )
        ureq = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={
                **headers,
                "Content-Type": "application/octet-stream",
                "Content-Length": str(len(data)),
            },
        )
        with urllib.request.urlopen(ureq) as resp:
            out = json.load(resp)
        print(f"  -> remote size={out.get('size')} name={out.get('name')}")
        if out.get("size") != len(data):
            raise SystemExit(f"size mismatch after upload {name}")

    # final verify
    req2 = urllib.request.Request(
        f"https://api.github.com/repos/hkx1997/CardKey/releases/tags/{tag}",
        headers=headers,
    )
    with urllib.request.urlopen(req2) as resp:
        rel2 = json.load(resp)
    print("==> remote assets")
    by_name = {a["name"]: a["size"] for a in rel2.get("assets") or []}
    for name in files:
        local = (dist / name).stat().st_size
        remote = by_name.get(name)
        print(f"  {name}: local={local} remote={remote}")
        if remote != local:
            raise SystemExit(f"verify fail {name}")
    print(f"OK: {tag} full SPA binaries on GitHub")
    print(f"https://github.com/hkx1997/CardKey/releases/tag/{tag}")


if __name__ == "__main__":
    main()
