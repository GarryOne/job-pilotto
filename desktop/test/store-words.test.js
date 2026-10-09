// The window says "Notion" only while Notion holds the data (renderer/store-words.js). A ratchet: each file's hard-coded "Notion"
// sentences (in quotes, not a comment, a link label or the connect prompt) may only go down; new ones go through storeName()/byStore().
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {counts} from './store-words-count.js';

const desktop = path.join(import.meta.dirname, '..');
// Files with Notion sentences left (9 Oct 2026), at their count: lower it when you convert one, never raise it
// (regenerate: node --input-type=module -e "import {counts} from './test/store-words-count.js'; …").
const ALLOWED = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'store-words-allowed.json'), 'utf8'));

test('no file says "Notion" in more sentences than it did (use storeName()/byStore() from renderer/store-words.js)', () => {
  const over = Object.entries(counts(desktop)).filter(([file, n]) => n > (ALLOWED[file] || 0)).map(([file, n]) => `${file}: ${n} (allowed ${ALLOWED[file] || 0})`);
  assert.deepEqual(over, []);
});
