import test from 'node:test';
import assert from 'node:assert/strict';
import {branch, title} from '../lib/dev-marker.js';

test('the window title says DEV and the branch only when running from source', () => {
  assert.equal(title(false, 'main'), 'Job Pilotto');
  assert.equal(title(true, 'dev-marker'), 'Job Pilotto · DEV · dev-marker');
  assert.equal(title(true, ''), 'Job Pilotto · DEV');
});

test('no git (a packaged app, a copy without .git): no branch, no crash', () => {
  assert.equal(branch('/', () => { throw new Error('not a git repository'); }), '');
  assert.equal(branch('/', () => 'main\n'), 'main');
});
