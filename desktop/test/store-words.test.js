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

test('index.html counts too: visible words and titles, not what the page already handles by store', async () => {
  const {countHtml} = await import('./store-words-count.js');
  assert.equal(countHtml('<p title="Saved to Notion">Hi</p>'), 1, 'a title is read');
  assert.equal(countHtml('<p class="muted">Saved to Notion 🎤 Interviews</p>'), 1, 'visible text');
  assert.equal(countHtml('<button data-notion-only>Edit in your Notion</button>\n<b data-store-saved>Saved in Notion</b>'), 0, 'handled by the page');
  assert.equal(countHtml('<button id="notion-go" data-x="notion">Connect with Notion</button>\n<!-- Notion here -->'), 0, 'about Notion itself, ids, comments');
});
