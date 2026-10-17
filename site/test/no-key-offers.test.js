// The website no longer offers a founder or friend key (owner, 17 Oct 2026: the free trial is open to everyone); the app's own screens are checked in desktop/test/plan-line.test.js.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const pub = name => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('no public page offers a key or sends people to Settings → License', () => {
  for (const name of ['index.html', 'friends.html']) {
    assert.doesNotMatch(pub(name), /founder key|Founder keys|key from me|Paste (?:a|your) license key|Settings → License/i, name);
  }
  assert.match(pub('friends.html'), /Settings → Plan/, 'friends.html points to the Plan page');
});
