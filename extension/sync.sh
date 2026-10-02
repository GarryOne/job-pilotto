#!/usr/bin/env bash
# The page helpers are shared with the Playwright launchers; tools/ holds the originals.
# Run after changing tools/browser-submit-guard.js or tools/browser-form-fastpath.js
# (worker/test/extension-files.test.js fails while the copies differ).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cp "$here/../tools/browser-submit-guard.js" "$here/../tools/browser-form-fastpath.js" "$here/page/"
echo "Synced page helpers into extension/page/"
# The snapshot scrubber (extension/page/snapshot.js, between "// <scrub>" and "// </scrub>") has a copy in
# worker/src/snapshot.js (worker/test/snapshot.test.js fails while they differ).
node -e '
const fs = require("fs"), page = fs.readFileSync(process.argv[1], "utf8"), file = process.argv[2], worker = fs.readFileSync(file, "utf8");
const cut = (s, start, end) => [s.indexOf(start), s.indexOf(end) + end.length];
const [a, b] = cut(page, "  // <scrub>", "  // </scrub>\n"), [c, d] = cut(worker, "// <scrub>", "// </scrub>\n");
const block = page.slice(a, b).split("\n").map(l => l.replace(/^  /, "")).join("\n");
fs.writeFileSync(file, worker.slice(0, c) + block + worker.slice(d));
' "$here/page/snapshot.js" "$here/../worker/src/snapshot.js"
echo "Synced the snapshot scrubber into worker/src/snapshot.js"
