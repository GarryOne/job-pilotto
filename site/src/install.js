// GET /install: the Mac installer script, for `curl -fsSL https://www.jobpilotto.workers.dev/install | bash`.
// Files downloaded by curl carry no quarantine flag, so the app opens without Gatekeeper's "Not Opened" /
// "Open Anyway" (the app isn't notarized yet). Also updates an installed copy. Each run is counted as a Mac
// download (button "terminal"); curl isn't a bot here.

const ZIP = 'https://github.com/GarryOne/job-pilotto/releases/latest/download/Job-Pilotto-mac-arm64.zip';

// Where the person came from (the link they followed carried ?src=reddit-devops): a short slug, or nothing.
export function cleanSource(value) {
  const slug = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_.-]{0,39}$/.test(slug) ? slug : '';
}

export function script(origin, source = '') {
  const channel = cleanSource(source);  // a validated slug: safe to put in the script
  return `#!/bin/bash
# Job Pilotto for Mac: installs (or updates) the app in Applications and opens it.
#   curl -fsSL ${origin}/install | bash
#   curl -fsSL ${origin}/install | bash -s JP1.…   (with a founder key from an invite)
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

# A founder key (invited testers: bash -s JP1.…): the app takes it at its next start, unlocks itself and starts
# the \$1 free AI credit, so setup skips the AI step (desktop/lib/pending-license.js).
key="\${1:-}"
if [ -n "$key" ]; then
  case "$key" in
    JP1.*)
      dir="$HOME/Library/Application Support/Job Pilotto"
      mkdir -p "$dir" && (umask 077 && printf '%s' "$key" > "$dir/pending-license.txt")
      echo 'Founder key saved: the app unlocks itself and starts with $1 of free AI.' ;;
    *) echo "That isn't a Job Pilotto key (it starts with JP1.); installing without it." ;;
  esac
fi
# Where this install came from (the install link's ?src=): left for the app, which reports it once with its own anonymous
# id so /telemetry can tell which channel brings people who finish setup (desktop/lib/install-source.js).
channel='${channel}'
if [ -n "$channel" ]; then
  dir="$HOME/Library/Application Support/Job Pilotto"
  mkdir -p "$dir" && printf '%s' "$channel" > "$dir/install-source.txt"
fi
echo "Installed $(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo '') in Applications. Opening it…"
open "$APP"
`;
}

export async function install(request, env, ctx, record) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, {status: 405});
  const url = new URL(request.url);
  if (request.method === 'GET' && record) {
    const save = record(request, env, {platform: 'mac', button: 'terminal', ...(cleanSource(url.searchParams.get('src')) ? {source: cleanSource(url.searchParams.get('src'))} : {})}).catch(error => console.log('install stat failed', error.message));
    if (ctx?.waitUntil) ctx.waitUntil(save); else await save;
  }
  return new Response(script(url.origin, url.searchParams.get('src')), {headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'}});
}
