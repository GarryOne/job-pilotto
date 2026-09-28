// Automatic backup of what lives only on this Mac (call recordings, tailored CVs, the CV, settings, job cache):
// once a week an export (lib/reset.js, never the keys) goes to iCloud Drive when it's set up, else Documents.
// The last KEEP backups are kept. Notion holds everything else, so this is only for the Mac-only files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as reset from './reset.js';

export const EVERY_MS = 7 * 24 * 3600 * 1000;
export const KEEP = 4;
const PREFIX = 'Job Pilotto backup ';

export function folder(home = os.homedir(), exists = fs.existsSync) {
  const icloud = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
  return path.join(exists(icloud) ? icloud : path.join(home, 'Documents'), 'Job Pilotto Backups');
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
