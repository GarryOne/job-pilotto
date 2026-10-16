// A failure a test plants on purpose says so where it plants it (16 Oct 2026): the fakes (AI, Notion, Telegram, Google) and the recall benchmark call markPlanted(), and the
// app's Sentry reporter (desktop/lib/planted.js) then drops what the plant caused, so CI e2e keeps reporting real errors only. Guard: desktop/e2e/test/planted.test.mjs.
import fs from 'node:fs';

// markPlanted(why): one line "<ms> <why>" in the file named by JOB_PILOTTO_E2E_PLANTED_FILE (set by suite.mjs for the app and the runner alike). No file: nothing happens.
export function markPlanted(why, env = process.env, now = Date.now()) {
  const file = env.JOB_PILOTTO_E2E_PLANTED_FILE;
  if (!file) return false;
  try { fs.appendFileSync(file, `${now} ${String(why).replace(/\s+/g, ' ').slice(0, 80)}\n`); return true; } catch { return false; }
}
