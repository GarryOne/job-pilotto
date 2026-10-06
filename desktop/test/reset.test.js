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

// A data folder as an install really has it (6 Oct 2026, the owner's Mac): the user's files, Chromium's, logs and locks.
const KEPT = ['settings.json', 'runs.json', 'cv.pdf', 'cv.previous.pdf', 'profile.md', 'answers.md', 'draft.json', 'misses.json', 'sessions.json',
  'review-states.json', 'queue.json', 'cv/v2.pdf', 'cover-letter/acme.md', 'interviews/call.json', 'recordings/call.webm', 'apply-runs/run.json',
  'config/search.json', 'config/preferences.json', 'data/jobs.sqlite', 'data/places.json', 'data/reports/last-run.json'];
const DROPPED = ['secrets.json', 'Cache/data_0', 'Code Cache/js/x', 'GPUCache/x', 'GraphiteDawnCache/x', 'DawnWebGPUCache/x', 'view-cache/jobs.json',
  'recipes-cache.json', 'Local Storage/leveldb/x', 'Session Storage/x', 'IndexedDB/x', 'Network/Cookies', 'Network Persistent State', 'Local State',
  'Preferences', 'SingletonLock', 'DIPS', 'DIPS-wal', 'logs/app.log', 'bin/python3', 'data/run.lock', 'data/insights.lock'];

test('export then import brings back every file of the user, 1:1, and none of Chromium\'s, the logs or the locks', () => {
  const a = profile();
  for (const name of [...KEPT, ...DROPPED]) {
    fs.mkdirSync(path.dirname(path.join(a.dir, name)), {recursive: true});
    fs.writeFileSync(path.join(a.dir, name), `content of ${name}`);
  }
  const file = path.join(a.base, 'export.tar.gz');
  reset.exportTo(a.dir, file, {keys: {NOTION_TOKEN: 'ntn_real'}});
  const b = profile();
  reset.stageImport(b.dir, file);
  reset.applyPending(b.dir);
  for (const name of KEPT) assert.equal(fs.readFileSync(path.join(b.dir, name), 'utf8'), `content of ${name}`, `${name} came back as it was`);
  for (const name of DROPPED) assert.ok(!fs.existsSync(path.join(b.dir, name)) || name === 'secrets.json', `${name} is not exported`);
  // secrets.json here is the one adoptKeys writes from keys.json, sealed for this computer: the exported computer's sealed file never travels.
  const imported = createStorage(b.dir, fakeCrypto);
  reset.adoptKeys(imported);
  assert.equal(imported.secret('NOTION_TOKEN'), 'ntn_real');
});

test('every file the app keeps in its data folder is exported, unless it is left out on purpose', () => {
  // The class, not one case: each top-level name main.js or lib/ reads or writes there. A new file is exported by default; one that must not
  // travel goes in reset.LEFT_OUT and in this list, with its reason.
  const ON_PURPOSE = {'secrets.json': 'sealed for this computer; keys travel as keys.json', bin: 'rebuilt at start'};
  const here = path.dirname(new URL(import.meta.url).pathname);
  const sources = [path.join(here, '..', 'main.js'), ...fs.readdirSync(path.join(here, '..', 'lib')).filter(f => f.endsWith('.js')).map(f => path.join(here, '..', 'lib', f))];
  const names = new Set();
  const pattern = /(?:storage\.(?:writeText|readText|path)\(|writeJson\(|readJson\(|path\.join\(storage\.dir, )'([^'/]+)'/g;
  for (const source of sources) for (const match of fs.readFileSync(source, 'utf8').matchAll(pattern)) names.add(match[1]);
  assert.ok(names.has('profile.md') && names.has('settings.json'), 'the scan finds the app\'s files');
  for (const name of names) {
    const left = reset.LEFT_OUT.some(rule => rule.test(name));
    assert.equal(left, name in ON_PURPOSE, left ? `${name} is left out of exports without a reason here` : `${name} must be exported`);
  }
});

test('a reset and then an import in the same minute both happen: each backup gets its own folder', () => {
  const a = profile();
  fs.writeFileSync(path.join(a.dir, 'profile.md'), 'mine');
  const file = path.join(a.base, 'export.tar.gz');
  reset.exportTo(a.dir, file);
  const minute = new Date('2026-10-06T18:13:10Z');
  reset.request(a.dir, {backup: true});
  const first = reset.applyPending(a.dir, minute);
  createStorage(a.dir, fakeCrypto).saveSettings({setupDone: false});   // the app's fresh start at the setup
  reset.stageImport(a.dir, file);
  const second = reset.applyPending(a.dir, new Date('2026-10-06T18:13:50Z'));
  assert.equal(second.imported, true);
  assert.notEqual(second.backup, first.backup);
  assert.equal(fs.readFileSync(path.join(a.dir, 'profile.md'), 'utf8'), 'mine');
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
