// Is a failure being planted on purpose right now? (16 Oct 2026.) Only the end-to-end journey on CI has a planted file (desktop/e2e/lib/planted.mjs writes one line per
// planted failure served); the Sentry reporter asks before it sends, so an error a test caused never uses the monthly quota. A user's install has no such file: always false.
import fs from 'node:fs';

export const PLANT_WINDOW_MS = 120_000;   // what a planted failure causes (a run's warning, a stopped task) is reported within this long after it was served

export function plantedRecently(env = process.env, now = Date.now(), read = file => fs.readFileSync(file, 'utf8')) {
  const file = env.JOB_PILOTTO_E2E_PLANTED_FILE;
  if (!file || !env.JOB_PILOTTO_E2E) return false;
  try {
    const last = read(file).trim().split('\n').pop();
    const at = Number(String(last).split(' ')[0]);
    return at > 0 && now - at <= PLANT_WINDOW_MS;
  } catch { return false; }
}
