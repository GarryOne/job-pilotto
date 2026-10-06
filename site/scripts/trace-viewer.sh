#!/usr/bin/env bash
# Copies Playwright's trace viewer (static files, Apache-2.0) from the e2e suites' playwright-core into site/public/trace-viewer/, where /admin/e2e opens traces.
# Re-run after upgrading playwright-core in desktop/e2e, so the viewer reads the traces the suites write. The viewer holds no data: a trace comes from /admin/e2e/trace/ (admins only).
set -euo pipefail
cd "$(dirname "$0")/../.."
from="$(cd desktop/e2e && node -p "require('path').dirname(require.resolve('playwright-core/package.json'))")/lib/vite/traceViewer"
to=site/public/trace-viewer
rm -rf "$to" && cp -R "$from" "$to"
version="$(cd desktop/e2e && node -p "require('playwright-core/package.json').version")"
echo "$version" > "$to/VERSION"
echo "trace viewer $version → $to ($(find "$to" -type f | wc -l | tr -d ' ') files)"
