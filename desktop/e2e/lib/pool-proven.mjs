// The "proven live" records a CI pool run sends (owner, 12 Oct 2026; site/src/applying-proven.js joins them to the Fixed tab): ONE per pool row that REALLY ran in this run,
// i.e. it reached a page the extension decided on. Skipped (a site limit), gone, refused, a bot wall on the runner's IP, a form covered after the fill, a tripwire hit or a run without
// AI is no proof. Names, shas, a PR number, commit subjects: never an address. Guard: e2e/test/pool-proven.test.mjs.
import {SITE_REFUSED} from './smoke.mjs';

const REAL = new Set(['posting', 'account', 'form', 'ready']);
const ran = item => REAL.has(item?.reached) && item.note !== SITE_REFUSED && !item.blocked && !item.aiRefused && !item.tripped;

// report: the day report (smoke.mjs); ctx: {run, branch, pr, sha, subjects, at}. -> [record]
export function recordsOf(report = {}, ctx = {}) {
  const inRun = report.thisRun?.ran ? new Set(report.thisRun.ran) : null;
  return Object.entries(report.results || {}).filter(([row, item]) => (!inRun || inRun.has(row)) && ran(item)).map(([row, item]) => ({
    row, sha: String(ctx.sha || ''), branch: ctx.branch || null, pr: ctx.pr || null, subjects: (ctx.subjects || []).slice(0, 15), reached: item.reached,
    applicant: item.applicant === 'grown' ? 'grown' : 'thin', run: String(ctx.run || ''), at: ctx.at}));
}
