// desktop/scripts/*.mjs run only on CI (windows-smoke.mjs on a Windows runner) or by hand, so no local test ever loaded them:
// 9 Oct 2026, a removed export (updater.js windowsUpdateScript) failed the Windows build 20 minutes in, at the smoke test.
// Every named import a script takes from ../lib must still be exported there.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const scripts = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

test('every named import a script takes from lib/ exists there', async () => {
  const missing = [];
  let checked = 0;
  for (const file of fs.readdirSync(scripts).filter(name => name.endsWith('.mjs'))) {
    const source = fs.readFileSync(path.join(scripts, file), 'utf8');
    for (const [, names, from] of source.matchAll(/^import\s*\{([^}]+)\}\s*from\s*'(\.\.\/lib\/[^']+)'/gm)) {
      const module = await import(path.join(scripts, from));
      for (const name of names.split(',').map(part => part.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
        checked++;
        if (!(name in module)) missing.push(`${file}: ${name} from ${from}`);
      }
    }
  }
  assert.ok(checked > 0, 'the scan found the scripts\' imports');
  assert.deepEqual(missing, []);
});
