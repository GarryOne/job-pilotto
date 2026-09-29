// GET /install: the Mac installer script, for `curl -fsSL https://www.jobpilotto.workers.dev/install | bash`.
// Files downloaded by curl carry no quarantine flag, so the app opens without Gatekeeper's "Not Opened" /
// "Open Anyway" (the app isn't notarized yet). Also updates an installed copy. Each run is counted as a Mac
// download (button "terminal"); curl isn't a bot here.

const ZIP = 'https://github.com/GarryOne/job-pilotto/releases/latest/download/Job-Pilotto-mac-arm64.zip';

export function script(origin) {
  return `#!/bin/bash
# Job Pilotto for Mac: installs (or updates) the app in Applications and opens it.
#   curl -fsSL ${origin}/install | bash
set -euo pipefail
[ "$(uname -s)" = Darwin ] || { echo "This installer is for macOS. Windows: ${origin}/download/windows"; exit 1; }
[ "$(uname -m)" = arm64 ] || { echo "Job Pilotto needs a Mac with Apple silicon (M1 or newer)."; exit 1; }

APP="/Applications/Job Pilotto.app"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Downloading Job Pilotto…"
curl -fL --progress-bar -o "$tmp/app.zip" "${ZIP}"
ditto -x -k "$tmp/app.zip" "$tmp/unpacked"

if pgrep -f "/Job Pilotto.app/Contents/MacOS/" >/dev/null; then
  echo "Quitting the running Job Pilotto…"
  osascript -e 'quit app "Job Pilotto"' >/dev/null 2>&1 || true
  for _ in $(seq 30); do pgrep -f "/Job Pilotto.app/Contents/MacOS/" >/dev/null || break; sleep 1; done
fi

rm -rf "$APP"
mv "$tmp/unpacked/Job Pilotto.app" "$APP"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
echo "Installed $(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo '') in Applications. Opening it…"
open "$APP"
`;
}

export async function install(request, env, ctx, record) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, {status: 405});
  const url = new URL(request.url);
  if (request.method === 'GET' && record) {
    const save = record(request, env, {platform: 'mac', button: 'terminal'}).catch(error => console.log('install stat failed', error.message));
    if (ctx?.waitUntil) ctx.waitUntil(save); else await save;
  }
  return new Response(script(url.origin), {headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'}});
}
