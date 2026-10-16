// A failure a test plants on purpose says so where it plants it (16 Oct 2026): the fakes (AI, Notion, Telegram, Google) and the recall benchmark call markPlanted(), and the
// app's Sentry reporter (desktop/lib/planted.js) then drops only the reports that plant causes, so CI e2e keeps reporting real errors. Guard: desktop/e2e/test/planted.test.mjs.
import fs from 'node:fs';

// What a failing service makes the app report: a run's warning or failure (a hung one: a stopped run). A recall plant throws in the page: a crash that says "recall planted".
export const SERVICE_REPORTS = ['run_warning', 'run_failed'];
export const HUNG_REPORTS = {kinds: ['run_failed', 'stuck'], text: 'no output'};
export const RECALL_REPORTS = {kinds: ['crash'], text: 'recall planted'};

// markPlanted(why, {kinds, text}): one JSON line in the file named by JOB_PILOTTO_E2E_PLANTED_FILE (set by suite.mjs for the app and the runner alike): the report kinds this
// plant causes and, when it has one, the text that report carries. No file: nothing happens.
export function markPlanted(why, {kinds = SERVICE_REPORTS, text = ''} = {}, env = process.env, now = Date.now()) {
  const file = env.JOB_PILOTTO_E2E_PLANTED_FILE;
  if (!file) return false;
  try { fs.appendFileSync(file, `${JSON.stringify({at: now, why: String(why).slice(0, 80), kinds, text})}\n`); return true; } catch { return false; }
}
