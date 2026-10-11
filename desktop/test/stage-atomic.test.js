// Staging (scripts/stage.mjs) never leaves shared/ half-built for a reader in the same worktree: it builds into its own folder and swaps it in
// (11 Oct 2026: the Stop hook re-staged while ship.sh's push gate ran its tests there; they failed in 0 s on a half-deleted shared/).
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = fs.readFileSync(path.join(desktop, 'scripts', 'stage.mjs'), 'utf8');

test('a full staging builds elsewhere and swaps shared/ in with renames, never deleting it first', () => {
  assert.doesNotMatch(script, /rmSync\(path\.join\(desktop, 'shared'\)/, 'shared/ must not be deleted before the new copy is complete');
  assert.match(script, /\.shared-staging-\$\{process\.pid\}/);
  assert.match(script, /fs\.renameSync\(out, shared\)/);
});

test('after a staging, shared/ is complete and no temporary folder is left behind', () => {
  execFileSync('node', ['scripts/stage.mjs', '--files-only'], {cwd: desktop, stdio: 'ignore'});
  for (const file of ['recipe-schema.js', 'alias-schema.js', 'ladder-core.js', 'worker']) assert.ok(fs.existsSync(path.join(desktop, 'shared', file)), file);
  assert.deepEqual(fs.readdirSync(desktop).filter(name => /^\.shared-staging-|^shared\.old-/.test(name)), []);
});
