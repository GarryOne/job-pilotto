// Automatic backup of what lives on this Mac (call recordings, tailored CVs, the CV, settings, job cache, and with the SQLite store
// the user's whole record: data/tracker.sqlite and profile.md/answers.md/knowledge.md, their only copy): once a week an export
// (lib/reset.js, never the keys) goes to iCloud Drive (Mac) or OneDrive's Documents (Windows) when it's set up, else Documents. The last KEEP backups are kept.
// Guards: test/files.test.js, e2e/suites/backup.mjs (Mac, Linux and Windows).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as reset from './reset.js';

export const EVERY_MS = 7 * 24 * 3600 * 1000;
export const KEEP = 4;
const PREFIX = 'Job Pilotto backup ';

// -> the backups folder. A test run names its own (JOB_PILOTTO_BACKUP_DIR, honoured only under JOB_PILOTTO_E2E: it must never reach the owner's folders).
// Cloud folders are found by looking, never by a user name: iCloud Drive on a Mac, OneDrive's Documents (its "backed up" Documents folder) on Windows.
export function folder(home = os.homedir(), exists = fs.existsSync, {env = process.env, platform = process.platform} = {}) {
  if (env.JOB_PILOTTO_E2E && env.JOB_PILOTTO_BACKUP_DIR) return env.JOB_PILOTTO_BACKUP_DIR;
  const join = platform === 'win32' ? path.win32.join : path.posix.join;   // by the platform asked about, so a test can ask about either from any host
  const icloud = join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
  const oneDrive = [env.OneDriveConsumer, env.OneDrive, env.OneDriveCommercial].filter(Boolean).map(root => join(root, 'Documents')).find(dir => exists(dir));
  const base = platform === 'darwin' && exists(icloud) ? icloud : platform === 'win32' && oneDrive ? oneDrive : join(home, 'Documents');
  return join(base, 'Job Pilotto Backups');
}

// -> the place's name as the card shows it
export function place(dir) {
  return /CloudDocs/.test(dir) ? 'iCloud Drive' : /OneDrive/i.test(dir) ? 'OneDrive' : 'Documents';
}

export function due(settings, now = Date.now()) {
  return !settings.lastBackupAt || now - Date.parse(settings.lastBackupAt) >= EVERY_MS;
}

// -> {file, removed: [older backups deleted]}
export function run(storage, {target = folder(), version = '', now = new Date()} = {}) {
  fs.mkdirSync(target, {recursive: true});
  const file = path.join(target, `${PREFIX}${now.toISOString().slice(0, 16).replace('T', ' ').replace(':', '.')}.tar.gz`);
  reset.exportTo(storage.dir, file, {version}, now);
  const all = fs.readdirSync(target).filter(name => name.startsWith(PREFIX) && name.endsWith('.tar.gz')).sort();
  const removed = all.slice(0, Math.max(0, all.length - KEEP));
  for (const name of removed) fs.rmSync(path.join(target, name), {force: true});
  storage.saveSettings({lastBackupAt: now.toISOString(), lastBackupFile: file});
  return {file, removed};
}
