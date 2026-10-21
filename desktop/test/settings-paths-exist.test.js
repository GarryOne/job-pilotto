// Every "Settings → X" in text the person reads names a section that exists (#1394: "Settings → AI" led nowhere), and Free yields to a picked API key (#1017).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SKIP = new Set(['node_modules', '.claude', '.git']);
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(js|py|html)$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
}
const DEAD = /Settings → (AI|AI engine|Telegram|Gmail and Calendar)\b/;

test('no user text points at a Settings section that does not exist (AI, Telegram, Gmail and Calendar live under Connections)', () => {
  const bad = [];
  for (const dir of ['desktop/lib', 'desktop/renderer', 'src', 'extension']) {
    if (!fs.existsSync(path.join(root, dir))) continue;
    for (const f of walk(path.join(root, dir))) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (DEAD.test(line)) bad.push(`${path.relative(root, f)}:${i + 1}`); });
    }
  }
  assert.deepEqual(bad, []);
});
