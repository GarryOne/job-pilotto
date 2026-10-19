// Ready to send, why a night's forms still wait (owner, 19 Oct 2026: three forms sat on "Waiting its turn" for 2 h; nothing said whether the night was set for later, never started or silent).
// The night's state says it in fixed words the app words (desktop/renderer/pages/ready-rows.js): never page text. Guard: site/test/ready-why.test.js.
import {LIVE} from './ready-line.js';

export const SILENT_MIN = 5, RUN_MS = 3 * 3600 * 1000;   // RUN_MS: how long a started night lives (ready.js RUN_HOURS)

// row: the ready_batches row; jobs: its ready_jobs rows (state, started_at). -> null when the forms just take turns, else {kind, at?}:
// later (fill time ahead), soon (the next 5-minute check starts it), no-queue (the Queue is not set up), starting (the server was told a moment ago),
// silent (told long ago, no form ever reported), capped (the night's cost cap stopped it).
export function whyOf(env, row, jobs, now = new Date()) {
  if (!row || !jobs.some(job => LIVE.includes(`'${job.state}'`) && !job.cleared_at)) return null;
  if (row.state === 'capped') return {kind: 'capped'};
  if (row.state === 'queued') {
    if (row.fill_at && Date.parse(row.fill_at) > now.getTime()) return {kind: 'later', at: row.fill_at};
    return env.READY_QUEUE ? {kind: 'soon'} : {kind: 'no-queue'};
  }
  if (row.state !== 'running' || jobs.some(job => job.step || job.started_at)) return null;
  const at = row.expires_at ? new Date(Date.parse(row.expires_at) - RUN_MS).toISOString() : null;
  return {kind: at && now.getTime() - Date.parse(at) >= SILENT_MIN * 60000 ? 'silent' : 'starting', at};
}
