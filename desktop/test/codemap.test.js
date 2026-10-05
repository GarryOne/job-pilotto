// CODEMAP.md (the repo's file → purpose map for coding sessions) matches the code: run `node scripts/codemap.mjs`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {codemap} from '../scripts/codemap.mjs';

test('CODEMAP.md is up to date (else: node desktop/scripts/codemap.mjs)', () => {
  const file = path.resolve(import.meta.dirname, '..', '..', 'CODEMAP.md');
  assert.ok(fs.readFileSync(file, 'utf8') === codemap(), 'CODEMAP.md is stale: run node desktop/scripts/codemap.mjs and commit it');
});

// grep -i <word> CODEMAP.md only finds a file whose header says something: "Focus page." matches nothing a task would search for.
test('every CODEMAP.md description says what the file does (at least 25 characters, not just its name)', () => {
  const weak = fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', 'CODEMAP.md'), 'utf8').split('\n')
    .map(line => line.match(/^- `([^`]+)` — (.*)$/)).filter(Boolean)
    .filter(([, file, text]) => !text.startsWith('(no header') && text.length < 25);
  assert.deepEqual(weak.map(([, file, text]) => `${file}: ${text}`), [], 'header comment too short: say what the file does');
});
