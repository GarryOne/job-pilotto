// Settings → Your data: export, import and reset this computer's data folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as reset from '../lib/reset.js';
import {createStorage} from '../lib/storage.js';
import {tar} from '../lib/tar.js';

const fakeCrypto = {encrypt: v => Buffer.from(v).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString()};
function profile() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-'));
  const dir = path.join(base, 'Job Pilotto');
  const storage = createStorage(dir, fakeCrypto);
  storage.saveSettings({setupDone: true, cvName: 'CV.pdf'});
  storage.setSecret('NOTION_TOKEN', 'ntn_real');
  fs.writeFileSync(path.join(dir, 'cv.pdf'), 'PDF');
  fs.mkdirSync(path.join(dir, 'recordings'));
  fs.writeFileSync(path.join(dir, 'recordings', 'call.webm'), 'AUDIO');
  fs.mkdirSync(path.join(dir, 'Cache'));  // Chromium's: never exported
  return {base, dir, storage};
}

test('export then import on another computer: files and settings come back, keys only when asked', () => {
  const a = profile();
  const file = path.join(a.base, 'export.tar.gz');
  reset.exportTo(a.dir, file, {keys: {NOTION_TOKEN: 'ntn_real'}}, new Date('2026-09-28T12:00:00Z'));
  assert.ok(!fs.existsSync(path.join(a.dir, reset.KEYS_FILE)));  // the plain keys never stay in the data folder

  const b = profile();
  b.storage.saveSettings({cvName: 'other.pdf'});
  reset.stageImport(b.dir, file);
  const done = reset.applyPending(b.dir, new Date('2026-09-28T13:00:00Z'));
  assert.equal(done.imported, true);
  assert.ok(fs.existsSync(done.backup));  // what was there is kept
  assert.equal(JSON.parse(fs.readFileSync(path.join(done.backup, 'settings.json'), 'utf8')).cvName, 'other.pdf');
  const imported = createStorage(b.dir, fakeCrypto);
  assert.equal(imported.settings().cvName, 'CV.pdf');
  assert.equal(fs.readFileSync(path.join(b.dir, 'recordings', 'call.webm'), 'utf8'), 'AUDIO');
  assert.ok(!fs.existsSync(path.join(b.dir, 'Cache')));
  assert.equal(reset.adoptKeys(imported), 1);
  assert.equal(imported.secret('NOTION_TOKEN'), 'ntn_real');
  assert.ok(!fs.existsSync(path.join(b.dir, reset.KEYS_FILE)));
});

test('a file that is not a Job Pilotto export is refused and nothing changes', async () => {
  const a = profile();
  const bogus = path.join(a.base, 'bogus.tar.gz');
  fs.writeFileSync(path.join(a.base, 'x.txt'), 'x');
  const {execFileSync} = await import('node:child_process').then(m => m);
  execFileSync(tar(), ['-czf', bogus, '-C', a.base, 'x.txt']);
  assert.throws(() => reset.stageImport(a.dir, bogus), /not a Job Pilotto export/);
  assert.equal(reset.applyPending(a.dir), null);
});

test('reset: the data folder is moved to a backup (default) or deleted at the next start', () => {
  const a = profile();
  reset.request(a.dir, {backup: true});
  const done = reset.applyPending(a.dir, new Date('2026-09-28T12:05:00Z'));
  assert.equal(done.backup, `${a.dir} (backup 2026-09-28 12.05)`);
  assert.ok(!fs.existsSync(a.dir) && fs.existsSync(path.join(done.backup, 'cv.pdf')));
  const b = profile();
  reset.request(b.dir, {backup: false});
  assert.deepEqual(reset.applyPending(b.dir), {deleted: true});
  assert.ok(!fs.existsSync(b.dir));
  assert.equal(reset.applyPending(b.dir), null);  // nothing pending: nothing happens
});

test('Windows runs its own tar by full path, never a Git for Windows GNU tar from PATH', () => {
  assert.equal(tar('win32', {SystemRoot: 'C:\\Windows'}), 'C:\\Windows\\System32\\tar.exe');
  assert.equal(tar('darwin'), 'tar');
});
