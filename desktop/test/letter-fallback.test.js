// The base letter's "use it in forms" switch (owner, 18 Oct 2026): off by default, one meaning in the window and the engine, shown on the Cover letter tab.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {fallbackOn as engine} from '../lib/cover-letter.js';
import {fallbackOn as window} from '../renderer/pages/letter-fallback.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('the window and the engine read the base-letter switch the same way, off by default', () => {
  for (const settings of [undefined, {}, {letterFallback: false}, {letterFallback: true}, {letterFallback: 'yes'}]) {
    assert.equal(window(settings), engine(settings), JSON.stringify(settings));
  }
  assert.equal(engine({}), false);
  assert.equal(engine({letterFallback: true}), true);
});

test('the switch sits in the Cover letter panel, with words that say what it does', () => {
  const html = fs.readFileSync(path.join(here, '../renderer/index.html'), 'utf8');
  const panel = html.slice(html.indexOf('id="setting-letter"'), html.indexOf('</div>', html.indexOf('id="letter-pdf"')));
  assert.match(panel, /id="letter-fallback"/);
  assert.match(panel, /Use this approved base letter when a job has no tailored letter/);
});
