// Find jobs using your browser waiting on the person (7 Oct 2026): the app's banner turns the task's waiting step into a "Go to Chrome and allow" button.
// (That the extension asks only for declared origins: test/extension-permissions.test.js.)
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const read = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

test('the banner shows "Go to Chrome and allow" only while the task waits on the person', () => {
  assert.match(read('desktop/renderer/pages/runs-page.js'), /\/\^⏳ Waiting for you in Chrome\/\.test\(String\(running\.step ?? /);
  assert.match(read('desktop/lib/visits.js'), /onLine\('⏳ Waiting for you in Chrome:/, 'the task says it waits, as its running step');
});
