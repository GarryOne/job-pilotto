// Settings → Your data: export, import and reset this computer's Job Pilotto data (the data folder).
// The app can't replace its own data folder while it runs (Chromium keeps files open there), so import and
// reset are requested, the app restarts, and the folder is swapped at the very start of the next launch,
// before anything opens it. The current data is moved to a backup folder first (reset can delete instead).
// Nothing outside the folder is touched: the Notion workspace, the Keychain (Gmail sign-in, employer
// passwords) and a GitHub repo stay as they are.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {tar} from './tar.js';

const MARKER = 'reset-pending.json';
export const KEYS_FILE = 'keys.json';  // an export's keys, in plain text (only when the user asked for them)
// What an export holds: the user's files and state, not Chromium's caches.
export const ITEMS = ['settings.json', 'runs.json', 'cv.pdf', 'cv', 'interviews', 'recordings', 'config', 'data'];
const stamp = now => now.toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
export const backupName = (dir, now = new Date()) => `${dir} (backup ${stamp(now)})`;

// One .tar.gz file (tar is on macOS and Windows 10+): a manifest, the items, and keys.json if asked for.
export function exportTo(dir, file, {keys = null, version = ''} = {}, now = new Date()) {
  const extra = [];
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({app: 'Job Pilotto', version, exportedAt: now.toISOString(),
    keys: !!keys}, null, 1));
  extra.push('manifest.json');
  if (keys) { fs.writeFileSync(path.join(dir, KEYS_FILE), JSON.stringify(keys), {mode: 0o600}); extra.push(KEYS_FILE); }
  try {
    const items = [...ITEMS.filter(item => fs.existsSync(path.join(dir, item))), ...extra];
    execFileSync(tar(), ['-czf', file, '-C', dir, ...items]);
  } finally {
    for (const name of extra) fs.rmSync(path.join(dir, name), {force: true});
  }
  return file;
}

// Import: unpack next to the data folder and check it's a Job Pilotto export; the swap happens at the next start.
export function stageImport(dir, file) {
  const staged = `${dir} (import)`;
  fs.rmSync(staged, {recursive: true, force: true});
  fs.mkdirSync(staged, {recursive: true});
  execFileSync(tar(), ['-xzf', file, '-C', staged]);
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(staged, 'manifest.json'), 'utf8')); } catch {}
  if (manifest?.app !== 'Job Pilotto' || !fs.existsSync(path.join(staged, 'settings.json'))) {
    fs.rmSync(staged, {recursive: true, force: true});
    throw new Error('This file is not a Job Pilotto export');
  }
  fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({backup: true, import: staged}));
  return manifest;
}

export function request(dir, {backup = true} = {}, now = new Date()) {
  fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({backup, at: now.toISOString()}));
}

// At start-up -> null (nothing pending), or {backup: <folder>} / {deleted: true}, plus {imported: true}.
export function applyPending(dir, now = new Date()) {
  const marker = path.join(dir, MARKER);
  if (!fs.existsSync(marker)) return null;
  let wanted = {backup: true};
  try { wanted = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch {}
  const done = {};
  if (wanted.backup !== false) {
    done.backup = backupName(dir, now);
    fs.renameSync(dir, done.backup);
    fs.rmSync(path.join(done.backup, MARKER), {force: true});
  } else {
    fs.rmSync(dir, {recursive: true, force: true});
    done.deleted = true;
  }
  if (wanted.import && fs.existsSync(wanted.import)) {
    fs.renameSync(wanted.import, dir);
    fs.rmSync(path.join(dir, 'manifest.json'), {force: true});
    done.imported = true;
  }
  return done;
}

// After an import: keys that came in plain text are stored encrypted, and the plain file is deleted.
export function adoptKeys(storage) {
  const file = path.join(storage.dir, KEYS_FILE);
  if (!fs.existsSync(file)) return 0;
  let keys = {};
  try { keys = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  let adopted = 0;
  for (const [name, value] of Object.entries(keys)) {
    try { if (value) { storage.setSecret(name, value); adopted += 1; } } catch {}
  }
  fs.rmSync(file, {force: true});
  return adopted;
}
