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
