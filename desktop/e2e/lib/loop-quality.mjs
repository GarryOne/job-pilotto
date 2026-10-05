// How well the loop does, beyond precision and planted-bug recall (5 Oct 2026): five numbers for /self-heal. Each is null with a reason until it has data,
// never a made-up value. Pure: selfheal-stats.mjs gathers the inputs.
//   escape     bugs the Finder did NOT catch (the Notion Bug Tracker's "Caught by e2e": No - gap) of all bugs it could judge, last 30 days
//   mutation   the weekly mutation test's catch rate (mutation.yml)
//   verdicts   the verdict pass's accuracy from the owner's ticks in the weekly audits (verdict-audit issues)
//   regression fixed defects that came back (label `regression`) per defect closed by a fix
//   flake      failed-step issues marked `flaky` (passed on the same commit) of all failed-step issues
import {afterEpoch} from './stats-epoch.mjs';
import {auditScore} from './verdict-audit.mjs';
import {closedByFix, FLAKY, REGRESSION} from './triage.mjs';

const has = (issue, name) => (issue.labels || []).some(item => (item.name || item) === name);
const rate = (part, whole) => (whole ? Math.round(100 * part / whole) : null);

// Bug Tracker rows (Notion API pages) -> {rate, missed, late, caught, judged, byFinder} for the last `days`.
export function escapeRate(rows, {now = Date.now(), days = 30} = {}) {
  const select = (row, name) => row.properties?.[name]?.select?.name || '';
  const recent = rows.filter(row => { const at = row.properties?.['Found on']?.date?.start; return !at || now - Date.parse(at) <= days * 86400000; });
  // By the option's first word: the Tracker's options carry explanations ("Late (only after users or manual)", "No - gap").
  const is = (row, word) => new RegExp(`^${word}\\b`, 'i').test(select(row, 'Caught by e2e'));
  const caught = recent.filter(row => is(row, 'Yes')).length, late = recent.filter(row => is(row, 'Late')).length;
  const missed = recent.filter(row => is(row, 'No')).length, judged = caught + late + missed;
  return {rate: rate(missed, judged), missed, late, caught, judged};
}

export function loopQuality({issues = [], audits = [], mutation = null, tracker = null, trackerWhy = ''}) {
  const counted = issues.filter(afterEpoch);
  const regressions = counted.filter(issue => has(issue, REGRESSION)).length, fixed = counted.filter(closedByFix).length;
  const steps = counted.filter(issue => /·\s*test-failure\s*·/.test(issue.body || '') || has(issue, 'kind:test-failure')), flaky = steps.filter(issue => has(issue, FLAKY)).length;
  const ticks = audits.slice(0, 4).map(issue => auditScore(issue.body)).reduce((sum, item) => ({right: sum.right + item.right, wrong: sum.wrong + item.wrong}), {right: 0, wrong: 0});
  const escape = tracker ? escapeRate(tracker) : null;
  return {
    escape: escape && escape.judged ? {rate: escape.rate, note: `${escape.missed} of ${escape.judged} bugs found outside the Finder (${escape.late} caught late)`} : {rate: null, note: trackerWhy || 'no Bug Tracker rows with "Caught by e2e" yet'},
    mutation: mutation && mutation.score !== null && mutation.score !== undefined ? {rate: mutation.score, note: `${mutation.killed} of ${mutation.killed + mutation.survived} planted code bugs caught${mutation.unknown ? `, ${mutation.unknown} unknown` : ''} (${String(mutation.at || '').slice(0, 10)})`} : {rate: null, note: 'no mutation run yet (mutation.yml, Sundays)'},
    verdicts: ticks.right + ticks.wrong ? {rate: rate(ticks.right, ticks.right + ticks.wrong), note: `${ticks.right} of ${ticks.right + ticks.wrong} audited verdicts right`} : {rate: null, note: 'no audit ticked yet (verdict-audit issue, Saturdays)'},
    regression: {rate: rate(regressions, fixed), note: fixed ? `${regressions} came back of ${fixed} closed by a fix` : 'no defect closed by a fix yet'},
    flake: {rate: rate(flaky, steps.length), note: steps.length ? `${flaky} of ${steps.length} failed-step issues were flaky` : 'no failed-step issue yet'},
  };
}
