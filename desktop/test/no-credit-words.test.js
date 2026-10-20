// The $1 credit is gone (owner, 16 Oct 2026): no screen, page, README or code comment of the product may still offer "a free credit" or "$1 of AI".
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const WHERE = ['desktop/renderer', 'desktop/lib', 'desktop/main.js', 'site/public', 'site/src', 'site/web', 'site/admin', 'site/api', 'site/shared', 'site/worker', 'site-next', 'README.md', 'docs/ARCHITECTURE.md', 'src'];
const OLD = /free (AI )?credit|free-credit|\$1 (of|free)|trial credit|\\\$1 free/i;

test('no file the user sees or the product runs from still talks about the $1 free credit', () => {
  const files = execFileSync('git', ['ls-files', ...WHERE], {cwd: root, encoding: 'utf8'}).split('\n').filter(Boolean);
  const found = [];
  for (const file of files) {
    if (!/\.(js|mjs|html|css|md|py|cjs)$/.test(file)) continue;
    fs.readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, index) => { if (OLD.test(line)) found.push(`${file}:${index + 1}`); });
  }
  assert.deepEqual(found, []);
});
