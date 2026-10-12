// The pool's smoke on a GitHub runner (owner, 12 Oct 2026: by hand only, start simple; .github/workflows/pool-smoke.yml): the hard caps the workflow sets (rows,
// AI dollars), no Electron leg there (never a second visit after a block page; the runner has no Electron), and the job summary: one table row per run row, a bot
// wall on the runner's data-center IP shown as "blocked (CI IP)" and never a failure, red only for a row that did not finish (a harness error), the tripwire, or a
// refused AI (12 Oct 2026: the Tests key had no credit and the row ran without AI, which is no result).
// Used by smoke.mjs and pool-ci-summary.mjs. Guard: e2e/test/pool-ci.test.mjs.
import {SITE_REFUSED} from './smoke.mjs';
import {fallsBelow} from './pool-ci-state.mjs';

// -> {maxRows, maxUsd}; 0 = no cap. On CI both come from the workflow, or the run is refused before any site is visited.
export function ciLimits(env = process.env) {
  const maxRows = Number(env.SMOKE_MAX_ROWS || 0), maxUsd = Number(env.SMOKE_MAX_USD || 0);
  if (env.CI && !(maxRows >= 1)) throw new Error('pool on CI: SMOKE_MAX_ROWS (the row cap, at least 1) must come from the workflow');
  if (env.CI && !(maxUsd > 0)) throw new Error('pool on CI: SMOKE_MAX_USD (the AI dollar cap) must come from the workflow');
  return {maxRows: maxRows >= 1 ? Math.floor(maxRows) : 0, maxUsd: maxUsd > 0 ? maxUsd : 0};
}

// The first maxRows rows run; the rest are named as not run. -> {run, cut}
export const capRows = (rows, maxRows = 0) => (maxRows >= 1 ? {run: rows.slice(0, maxRows), cut: rows.slice(maxRows)} : {run: rows, cut: []});

// Checked before each row: the spend so far reached the cap.
export const overBudget = (spent, maxUsd = 0) => maxUsd > 0 && spent >= maxUsd;

// Why the run stops before its next row, or '': the dollar cap, or a refused AI (refused: {shape, why}: every later row would run without AI too, and spend a visit).
export function stopReason({spent = 0, maxUsd = 0, refused = null} = {}) {
  if (refused) return `the AI was refused on ${refused.shape} (${refused.why})`;
  return overBudget(spent, maxUsd) ? `AI spend $${spent.toFixed(4)} reached the cap $${maxUsd.toFixed(2)}` : '';
}

// The Electron leg (a fall or a refusal on plain node run again on Electron at once) is a Mac's: on CI it would be a second visit after a block page.
export const electronLegs = (env = process.env) => !env.CI;

const money = usd => `$${Number(usd || 0).toFixed(4)}`;
const cell = text => String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

// What stopped a row short of the form that is not ours: the runner's IP met a bot wall or the site refused it; or the form judge saw the page covered after the fill.
function blockedWord(item) {
  if (item.reached === 'code/bot') return 'blocked (CI IP): bot check';
  if (item.note === SITE_REFUSED) return 'blocked (CI IP): site refused';
  if (item.blocked) return `covered after the fill (${item.blocked})`;
  if (item.aiRefused) return 'AI refused';
  return '';
}

// A run where no row ran is never a pass (12 Oct 2026: #455's proof was green in a minute and ran nothing, refused by the site limit). -> '' or the line that leads
// the summary: "NOT RUN: <row>: <why>, <when the next visit is possible>". now: the clock (the site limit counts per UTC day on a runner).
export const nextDay = now => { const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)); return `${next.toISOString().slice(0, 10)} 00:00 UTC`; };
function notRunLine(report, now) {
  const run = report.thisRun || {};
  if (!Array.isArray(run.ran) || run.ran.length) return '';
  const limited = (run.skipped || []).map(({shape, why}) => {
    const found = String(why).match(/site-ledger: (\S+) is not visited: (.*?)\. Counted/);
    return `${shape}: the site limit (${found ? `${found[1]}: ${found[2]}` : String(why).slice(0, 140)}), next visit possible after ${nextDay(now)}`;
  });
  const gone = Object.entries(report.results || {}).filter(([, item]) => item.note).map(([shape, item]) => `${shape}: ${item.note}, replace its posting in desktop/e2e/smoke-sites.json`);
  const why = [...limited, ...gone, ...(run.stopped ? [run.stopped] : [])];
  return `NOT RUN: ${why.join('; ') || 'no row ran'}`;
}

// The day's report (smoke.mjs: results + thisRun) and each row's last CI run (baseline: lib/pool-ci-state.mjs baselines) -> {markdown, red: [reasons]} for
// $GITHUB_STEP_SUMMARY; red is empty when the run is green. Only the rows this run ran (the day's report also keeps other runs' rows).
export function summary(report = {}, {baseline = {}, now = new Date(), proof = false} = {}) {
  const run = report.thisRun || {}, ran = run.ran ? new Set(run.ran) : null;
  const results = Object.entries(report.results || {}).filter(([shape]) => !ran || ran.has(shape));
  const last = shape => { const base = baseline[shape]; return base ? `${base.reached}${base.filled != null ? ` ${base.filled} / ${base.left}` : ''} (run ${base.run}, ${base.branch})` : '–'; };
  const notRun = notRunLine(report, now);
  const red = [...(notRun && !proof ? [notRun] : []), ...(run.unfinished || []).map(item => `did not finish: ${item.shape} (${item.why})`),
    ...results.filter(([, item]) => item.tripped).map(([shape]) => `privacy tripwire: ${shape}`),
    ...results.filter(([, item]) => item.aiRefused).map(([shape, item]) => `AI refused: ${shape} (${item.aiRefused.calls} calls: ${item.aiRefused.why})`),
    ...results.map(([shape, item]) => [shape, fallsBelow(baseline[shape], item)]).filter(([, why]) => why).map(([shape, why]) => `less than its last CI run: ${shape} (${why})`)];
  const lines = [...(notRun ? [notRun, ''] : []), `## Pool smoke ${report.day || ''} ${red.length ? '❌' : '✅'}`, '',
    'Held: the fake applicant, never Submit, no account or consent button, no password, no captcha. Nothing uploaded from CI.', '',
    '| Row | Applicant | Reached | Filled / left | Blocked | Last CI run | AI | Time |', '|---|---|---|---|---|---|---|---|',
    ...results.map(([shape, item]) => `| ${cell(shape)} | ${cell(item.applicant || 'thin')} | ${cell(item.reached)} | ${item.filled != null ? `${item.filled} / ${item.left}` : '–'} | ${cell(blockedWord(item))} | ${cell(last(shape))} | ${money(item.usd)} | ${item.seconds ?? '?'} s |`),
    '', `AI spend: ${money(run.usd)} of the $${Number(run.maxUsd || 0).toFixed(2)} cap (the Tests key).`];
  if (run.stopped) lines.push(`Stopped early: ${run.stopped}.`);
  if ((run.cut || []).length) lines.push(`Not run: ${run.cut.join(', ')} (row cap ${run.maxRows}).`);
  if ((run.skipped || []).length) lines.push(`Skipped by CI's site limit: ${run.skipped.map(item => item.shape).join(', ')}.`);
  lines.push('', 'Site limit: CI keeps its own ledger per UTC day (2 visits per host, a host that showed a block page rests the day); CI visits are not in the Mac\'s ledger.',
    '"blocked (CI IP)" is the runner\'s data-center address meeting a bot wall or a refusal: never a failure, never retried.');
  if (red.length) lines.push('', ...red.map(reason => `- ❌ ${reason}`));
  return {markdown: `${lines.join('\n')}\n`, red, notRun};
}
