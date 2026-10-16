// The one-command install for invited testers: `curl …/install | bash -s JP1.…` leaves the founder key in
// <userData>/pending-license.txt. At the next start the app takes it once and unlocks the app (lib/license.js).
import fs from 'node:fs';
import path from 'node:path';

export const FILE = 'pending-license.txt';

export function consume(dir, {license}) {
  const file = path.join(dir, FILE);
  let key;
  try { key = fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
  fs.rmSync(file, {force: true});  // taken once, whatever happens next
  const set = license.set(key);
  if (!set.ok) return {ok: false, error: set.error};
  return {ok: true};
}
