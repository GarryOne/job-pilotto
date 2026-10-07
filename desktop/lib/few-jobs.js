// "Few new jobs" nudge (owner, 7 Oct 2026: "popup a dialog/button to recommend more methods if the last Search for new jobs found 0 or close"):
// after a finished jobs check with fewer than FEW new jobs (STREAK checks in a row), once per such check: a notification and
// an in-app prompt that open that run's "Few new jobs" box, a dot on Strategy, and one Telegram line at most once a week.
import {parseDigest} from '../renderer/run-cards.js';

export const FEW = 3;
export const STREAK = 1;   // the last check (owner: "if the last Search for new jobs found 0 new or close to"); was 2 until 7 Oct 2026
export const TELEGRAM_EVERY_MS = 7 * 86400000;
const CHECKS = new Set(['search', 'today']);

// New jobs of a finished check: the run's own count, else its digest's "🆕 N new"; null when unknown (never counted as few).
export function freshOf(run) {
  if (Number.isFinite(run?.new)) return run.new;
  const parsed = run?.message ? parseDigest(String(run.message)) : null;
  return Number.isFinite(parsed?.fresh) ? parsed.fresh : null;
}

// {runId, counts} when the latest STREAK finished checks (newest first, failed ones skipped) each found fewer than FEW, else null.
export function streak(runs) {
  const checks = (runs || []).filter(run => CHECKS.has(run.kind) && run.endedAt && run.ok !== false)
    .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt)).slice(0, STREAK);
  if (checks.length < STREAK) return null;
  const counts = checks.map(freshOf);
  if (counts.some(count => count === null || count >= FEW)) return null;
  return {runId: checks[0].id, counts};
}

// What to do now for this streak, given what was already said: {notify, telegram} (each true at most once per streak; Telegram weekly).
export function due(found, settings = {}, now = Date.now()) {
  if (!found || settings.fewJobsNudgedFor === found.runId) return {notify: false, telegram: false};
  return {notify: true, telegram: !settings.fewJobsTelegramAt || now - settings.fewJobsTelegramAt >= TELEGRAM_EVERY_MS};
}

export const words = found => ({
  title: 'Few new jobs: ways to find more',
  body: `The last check found ${found.counts[0]} new job${found.counts[0] === 1 ? '' : 's'}. See what would bring more, easiest first.`,
  telegram: `🔎 Your last job check found ${found.counts[0]} new job${found.counts[0] === 1 ? '' : 's'}. Open Job Pilotto → Strategy: a filter to loosen, words or places to add, `
    + 'job sources to connect, and sites only you can open.',
});
