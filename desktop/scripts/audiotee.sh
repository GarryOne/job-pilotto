#!/usr/bin/env bash
# Build AudioTee (github.com/makeusabrew/audiotee, MIT): a small Swift tool that captures the Mac's system
# audio (the call) through Core Audio taps, which needs only macOS's "System Audio Recording Only" permission,
# not Screen Recording. Output: build/bin/audiotee (npm start uses it; stage.mjs --app copies it into the app).
# Usage: scripts/audiotee.sh   (needs Xcode's Swift; skips if already built; npm start runs it, CI too)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
target="$here/build/bin/audiotee"
commit="56ac954"   # pinned: bump deliberately after reading the changes
if [ -x "$target" ]; then exit 0; fi
if ! command -v swift >/dev/null; then
  echo "AudioTee not built: install Xcode or its command line tools (xcode-select --install). Recording the call's audio falls back to screen capture."
  exit 0
fi
echo "Building AudioTee (once, about a minute)…"
src="$here/build/audiotee-src"
rm -rf "$src"
git clone -q https://github.com/makeusabrew/audiotee "$src"
git -C "$src" checkout -q "$commit"
(cd "$src" && swift build -c release --arch arm64 >/dev/null)
mkdir -p "$(dirname "$target")"
cp "$src/.build/release/audiotee" "$target"
echo "AudioTee by makeusabrew (github.com/makeusabrew/audiotee, commit $commit), MIT License as stated in its README." > "$here/build/bin/audiotee.LICENSE"
rm -rf "$src"
echo "AudioTee ready: $target"
