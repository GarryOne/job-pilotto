// The panel's footer names the extension build (owner, 11 Oct 2026: a bug screenshot did not say which version ran, so the cause could not be placed on a build).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const review = fs.readFileSync(new URL('../../extension/review.js', import.meta.url), 'utf8');

test('the panel footer carries the extension version in its text and its tooltip', () => {
  assert.match(review, /const version = chrome\.runtime\.getManifest\(\)\.version; foot\.textContent/);
  assert.match(review, /foot\.textContent = `\$\{state\} · v\$\{version\}`; foot\.title = `Job Pilotto extension v\$\{version\}`;/);
});
