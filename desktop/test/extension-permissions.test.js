// Every site the extension asks Chrome for, or checks, is declared in its manifest: Chrome refuses a request for an undeclared origin with no prompt,
// and a check for one is always false (7 Oct 2026: the Allow page and the popup asked for 'http://*/*' too, so every Allow click said Not allowed).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const dir = new URL('../../extension/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', dir), 'utf8'));
const declared = new Set([...(manifest.host_permissions || []), ...(manifest.optional_host_permissions || [])]);

test('every literal origin in a permissions request, check or origins list is in manifest.json', () => {
  const asked = [];
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.js'))) {
    const source = fs.readFileSync(new URL(name, dir), 'utf8');
    for (const list of source.matchAll(/origins:\s*\[([^\]]*)\]/g)) {
      for (const literal of list[1].matchAll(/['"]([^'"]+)['"]/g)) asked.push([name, literal[1]]);
    }
  }
  assert.ok(asked.length >= 3, 'the check found the extension\'s origin lists');
  assert.deepEqual(asked.filter(([, origin]) => !declared.has(origin)), []);
});
