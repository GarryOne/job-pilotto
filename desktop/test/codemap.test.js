// The live code map (desktop/scripts/codemap.mjs): every source file's header says what it does, and a search finds a file by its words.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {codemap, search} from '../scripts/codemap.mjs';

// A search only finds a file whose header says something: "Focus page." matches nothing a task would look for.
test('every header comment says what its file does (at least 25 characters, not just its name)', () => {
  const weak = codemap().split('\n').map(line => line.match(/^- `([^`]+)` — (.*)$/)).filter(Boolean)
    .filter(([, , text]) => !text.startsWith('(no header') && text.length < 25);
  assert.deepEqual(weak.map(([, file, text]) => `${file}: ${text}`), [], 'add or lengthen the first-line comment: say what the file does');
});

test('a search returns the files whose path or purpose has every word, and the map is never written to disk', () => {
  const found = search(['ladder', 'digest']).split('\n');
  assert.ok(found.length >= 1 && found.every(line => /ladder/i.test(line) && /digest/i.test(line)), found.join('\n'));
  assert.equal(search(['no-such-word-anywhere-xyz']), '');
  assert.ok(!fs.existsSync(path.resolve(import.meta.dirname, '..', '..', 'CODEMAP.md')), 'CODEMAP.md is not committed any more: the map is live');
});
