// The one-command install for invited testers: `curl …/install | bash -s JP1.…` leaves the founder key in
// <userData>/pending-license.txt. At the next start the app takes it once: it unlocks the app (lib/license.js) and,
// when no Anthropic key is set yet, starts the $1 free AI credit (lib/ai-trial.js), so setup skips the AI step.
import fs from 'node:fs';
import path from 'node:path';
import * as aiTrial from './ai-trial.js';

export const FILE = 'pending-license.txt';

export function consume(dir, {license, storage, licenseState, env = process.env}) {
  const file = path.join(dir, FILE);
  let key;
  try { key = fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
  fs.rmSync(file, {force: true});  // taken once, whatever happens next
  const set = license.set(key);
  if (!set.ok) return {ok: false, error: set.error};
  const trial = storage.secret('ANTHROPIC_API_KEY') ? null : aiTrial.start(storage, licenseState, env);
  return {ok: true, trial: !!trial?.ok};
}
