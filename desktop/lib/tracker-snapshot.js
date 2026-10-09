// A consistent copy of data/tracker.sqlite (the SQLite store's records, a user's only copy) for an export or backup.
// The live file runs in WAL mode while the app and the engine write it, so copying it and its -wal file byte by byte can give a broken
// database; SQLite's own VACUUM INTO writes one complete file instead. Only a copy is made here: the schema stays the engine's
// (src/stores/sqlite.py). Guarded by desktop/test/tracker-snapshot.test.js.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

export const LIVE = path.join('data', 'tracker.sqlite');
export const SNAPSHOT = path.join('data', 'tracker.snapshot.sqlite');
// What an export leaves out instead (tar --exclude patterns, relative to the data folder).
export const LIVE_FILES = ['data/tracker.sqlite', 'data/tracker.sqlite-wal', 'data/tracker.sqlite-shm'];

const sqlite = () => createRequire(import.meta.url)('node:sqlite');  // loaded only when there is a tracker

// -> the snapshot's path relative to dir, or null when there is no tracker. The caller removes it after use.
export function take(dir) {
  const live = path.join(dir, LIVE);
  if (!fs.existsSync(live)) return null;
  const copy = path.join(dir, SNAPSHOT);
  fs.rmSync(copy, {force: true});
  const db = new (sqlite().DatabaseSync)(live);
  try { db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`); } finally { db.close(); }
  return SNAPSHOT;
}

// After an export is unpacked: its snapshot becomes the tracker.
export function restore(dir) {
  const copy = path.join(dir, SNAPSHOT);
  if (!fs.existsSync(copy)) return false;
  for (const name of LIVE_FILES) fs.rmSync(path.join(dir, name), {force: true});
  fs.renameSync(copy, path.join(dir, LIVE));
  return true;
}
