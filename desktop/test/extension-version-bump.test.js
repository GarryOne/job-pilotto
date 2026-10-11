// tools/extension-version-bump.mjs: the version taken at ship time (next free after main's; the branch's own bump kept only when it is already newer).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {newer, next, plan, setVersion} from '../../tools/extension-version-bump.mjs';

test('versions compare per part, not as text', () => {
  assert.equal(newer('0.9.190', '0.9.188'), true);
  assert.equal(newer('0.9.99', '0.9.188'), false);
  assert.equal(newer('0.9.188', '0.9.188'), false);
  assert.equal(next('0.9.188'), '0.9.189');
  assert.equal(next('0.9.99'), '0.9.100');
});

test('only a change to the extension takes a version; the fingerprint, README and sync.sh alone do not', () => {
  const base = '0.9.188';
  assert.deepEqual(plan({base, mine: base, changed: []}), {action: 'none'});
  assert.deepEqual(plan({base, mine: base, changed: ['extension/fingerprint.json', 'extension/README.md', 'extension/sync.sh']}), {action: 'none'});
  assert.deepEqual(plan({base, mine: base, changed: ['extension/page/fill.js']}), {action: 'bump', version: '0.9.189'});
});

test('a branch bumped to a number main already has gets the next free one; a newer one is kept', () => {
  assert.deepEqual(plan({base: '0.9.189', mine: '0.9.189', changed: ['extension/a.js']}), {action: 'bump', version: '0.9.190'});
  assert.deepEqual(plan({base: '0.9.189', mine: '0.9.188', changed: ['extension/a.js']}), {action: 'bump', version: '0.9.190'});
  assert.deepEqual(plan({base: '0.9.188', mine: '0.9.190', changed: ['extension/a.js']}), {action: 'keep', version: '0.9.190'});
});

test('setVersion changes only the version line', () => {
  assert.equal(setVersion('{\n  "manifest_version": 3,\n  "version": "0.9.188",\n  "name": "x"\n}\n', '0.9.189'), '{\n  "manifest_version": 3,\n  "version": "0.9.189",\n  "name": "x"\n}\n');
});
