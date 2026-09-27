#!/usr/bin/env bash
# The page helpers are shared with the Playwright launchers; tools/ holds the originals.
# Run after changing tools/browser-submit-guard.js or tools/browser-form-fastpath.js
# (worker/test/extension-files.test.js fails while the copies differ).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cp "$here/../tools/browser-submit-guard.js" "$here/../tools/browser-form-fastpath.js" "$here/page/"
echo "Synced page helpers into extension/page/"
