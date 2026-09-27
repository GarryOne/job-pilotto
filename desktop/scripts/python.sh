#!/usr/bin/env bash
# Bundle a standalone Python (python-build-standalone, CPython 3.12, Apple Silicon) with the pipeline's
# requirements into build/pilot/python, so the packaged app needs nothing installed on the Mac.
# Usage: scripts/python.sh   (run before `npm run build`; CI does this in .github/workflows/desktop.yml)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
target="$here/build/pilot/python"
arch="${PYTHON_ARCH:-aarch64-apple-darwin}"
if [ -x "$target/bin/python3" ]; then echo "Python already staged: $target"; exit 0; fi
api="https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest"
auth=(); [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
url="$(curl -fsSL ${auth[@]+"${auth[@]}"} "$api" | python3 -c "
import json, re, sys
assets = json.load(sys.stdin)['assets']
names = [a['browser_download_url'] for a in assets
         if re.search(r'cpython-3\.12\.\d+\+\d+-$arch-install_only\.tar\.gz$', a['name'])]
print(names[0])")"
echo "Downloading $url"
mkdir -p "$here/build/pilot"
curl -fsSL "$url" | tar -xz -C "$here/build/pilot"   # unpacks to build/pilot/python
"$target/bin/python3" -m pip install --quiet --disable-pip-version-check -r "$here/../requirements.txt"
# Interview recordings -> transcript with speakers, on the Mac (sherpa-onnx, PyAV, numpy; about 115 MB).
"$target/bin/python3" -m pip install --quiet --disable-pip-version-check -r "$here/../requirements-transcribe.txt"
# Parts of Python the pipeline never uses: its own tests, the Tk GUI toolkit, IDLE, caches.
lib="$(echo "$target"/lib/python3.12)"
rm -rf "$lib/test" "$lib/idlelib" "$lib/tkinter" "$lib/turtledemo" "$lib/lib2to3" "$lib/ensurepip" \
       "$target"/lib/libtcl* "$target"/lib/libtk* "$target"/lib/tcl* "$target"/lib/tk* "$target/share"
find "$target" -name "__pycache__" -type d -prune -exec rm -rf {} +
"$target/bin/python3" -c "import anthropic, sqlite3, ssl, json, sys, sherpa_onnx, av, numpy; print('Bundled Python', sys.version.split()[0], 'anthropic', anthropic.__version__, 'sherpa-onnx', sherpa_onnx.__version__)"
