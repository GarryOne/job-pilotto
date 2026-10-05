#!/usr/bin/env bash
# Bundle a standalone Python (python-build-standalone, CPython 3.12, Apple Silicon) with the pipeline's
# requirements into build/pilot/python, so the packaged app needs nothing installed on the Mac.
# Usage: scripts/python.sh   (run before `npm run build`; CI does this in .github/workflows/desktop.yml)
#        PYTHON_ARCH=x86_64-pc-windows-msvc scripts/python.sh   (Windows, in Git Bash: python.exe and Lib\)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
target="$here/build/pilot/python"
arch="${PYTHON_ARCH:-aarch64-apple-darwin}"
if [[ "$arch" == *windows* ]]; then py="$target/python.exe"; lib="$target/Lib"
else py="$target/bin/python3"; lib="$target/lib/python3.12"; fi
if [ -x "$py" ]; then echo "Python already staged: $target"; exit 0; fi
api="https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest"
auth=(); [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
url="$(curl -fsSL ${auth[@]+"${auth[@]}"} "$api" | "$(command -v python3 || command -v python)" -c "
import json, re, sys
assets = json.load(sys.stdin)['assets']
names = [a['browser_download_url'] for a in assets
         if re.search(r'cpython-3\.12\.\d+\+\d+-$arch-install_only\.tar\.gz$', a['name'])]
print(names[0])")"
echo "Downloading $url"
mkdir -p "$here/build/pilot"
curl -fsSL "$url" | tar -xz -C "$here/build/pilot"   # unpacks to build/pilot/python
"$py" -m pip install --quiet --disable-pip-version-check -r "$here/../requirements.txt"
# Interview transcription (sherpa-onnx, PyAV, numpy; ~115 MB) is not bundled: src/ai/transcribe.py installs it on the first recording.
# Parts of Python the pipeline never uses: its own tests, the Tk GUI toolkit, IDLE, caches.
rm -rf "$lib/test" "$lib/idlelib" "$lib/tkinter" "$lib/turtledemo" "$lib/lib2to3" "$lib/ensurepip" \
       "$target"/lib/libtcl* "$target"/lib/libtk* "$target"/lib/tcl* "$target"/lib/tk* "$target/share" "$target/tcl"
# setuptools (pip stays: it installs the transcription add-on), type stubs, test suites and the C headers the app never uses (~15 MB).
rm -rf "$lib/site-packages/setuptools" "$lib/site-packages/pkg_resources" "$lib/site-packages/_distutils_hack" \
       "$lib/site-packages"/setuptools-*.dist-info "$target/include" "$lib"/config-3.12-*
find "$lib/site-packages" \( -name tests -o -name test \) -type d -prune -exec rm -rf {} +
find "$lib/site-packages" -name "*.pyi" -delete
find "$target" -name "__pycache__" -type d -prune -exec rm -rf {} +
"$py" -c "import anthropic, sqlite3, ssl, json, sys, pip; print('Bundled Python', sys.version.split()[0], 'anthropic', anthropic.__version__)"
