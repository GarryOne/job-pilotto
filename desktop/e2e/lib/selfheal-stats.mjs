// The numbers of the self-healing loop, for the owner's page /self-heal (site/src/selfheal.js): every issue the loop filed, by the detector that found it and
// how it ended (real and fixed, real and queued, false positive, duplicate, test or harness, unclear), the fixer's pull requests, the verdict pass, what the
// AI cost, the recall of the planted bugs, and the real bugs worth knowing. Pure: the CLI (selfheal-stats.mjs) fetches, this computes. 4 Oct 2026.
import {afterEpoch} from './stats-epoch.mjs';
export const SCHEMA = 1;
export const CATEGORIES = ['fixed', 'queued', 'falsePositive', 'duplicate', 'harness', 'unclear', 'open'];
export const DETECTORS = {'ai-review': 'AI screenshot review', 'suite-failure': 'Failed test steps', 'interaction-probe': 'Interaction probe',
  'layout-check': 'Layout and DOM checks', 'code-review': 'AI code review', explorer: 'AI explorer'};

const names = issue => (issue.labels || []).map(label => label.name || label);
const said = issue => (issue.comments || []).map(comment => comment.body || '').join('\n');
export const detectorOf = issue => (names(issue).find(name => name.startsWith('source:')) || 'source:other').slice(7);

// How an issue ended. Real = confirmed by the verdict pass or a person (queued while open), or closed by a fix (a commit or a merged pull request).
export function classify(issue) {
  const labels = names(issue), text = said(issue), last = (issue.comments || []).at(-1)?.body || '';
  if (labels.includes('harness')) return 'harness';   // the verdict pass: the test was wrong, not the product (also wontfix-auto, so it is never filed again)
  if (labels.includes('wontfix-auto')) return 'falsePositive';
  if (/Duplicate of #\d+/.test(text)) return 'duplicate';
  if (!labels.includes('confirmed') && /Not a product (?:bug|finding)|plant(?:ed)? .*leak|the probe pressed|harness|test bug|e2e app counted|Dry run|Closing so the producer/i.test(text)) return 'harness';
  // A person (or the loop) closed it as "not planned" with a reason: it was not worth a fix, whether or not it carries the wontfix-auto label (4 Oct 2026: ~70 were closed by hand
  // and the weekly self-review could not learn from them). A closure by the "not seen in two runs" rule is not a judgement.
  if (issue.state === 'CLOSED' && issue.stateReason === 'NOT_PLANNED' && !/not seen in two runs/i.test(last)) return 'falsePositive';
  if (labels.includes('confirmed')) return issue.state === 'OPEN' ? 'queued' : 'fixed';
  if (issue.state === 'CLOSED' && /Fixed by|Fixes #|fixes this|Landed on main|Merged by|commit [0-9a-f]{7} says/i.test(text)) return 'fixed';
  if (issue.state === 'OPEN') return 'open';
  return /not seen in two runs/.test(last) ? 'unclear' : 'unclear';
}

const empty = () => Object.fromEntries(CATEGORIES.map(name => [name, 0]));
const day = date => String(date || '').slice(0, 10);

// -> the snapshot the site stores (one per day) and shows.
export function build({issues: all = [], prs = [], costs = [], recall = null, now = new Date()} = {}) {
  const issues = all.filter(afterEpoch), totals = {filed: 0, ...empty()}, by = {};
  for (const issue of issues) {
    const kind = classify(issue), source = detectorOf(issue);
    totals.filed++; totals[kind]++;
    const row = (by[source] ??= {detector: DETECTORS[source] || source, filed: 0, ...empty()});
    row.filed++; row[kind]++;
  }
  const real = totals.fixed + totals.queued, judged = real + totals.falsePositive;
  const verdicts = {real: 0, falsePositive: 0};
  for (const issue of issues) for (const comment of issue.comments || []) {
    if (/^(?:<!-- ui-loop-verdict:real -->|Judged real by the UI loop's verdict pass)/.test(comment.body || '')) verdicts.real++;
    if (/^(?:<!-- ui-loop-verdict:false-positive -->|Closed by the UI loop as a false positive)/.test(comment.body || '')) verdicts.falsePositive++;
  }
  const fixer = {opened: prs.length, merged: prs.filter(pr => pr.state === 'MERGED').length, closed: prs.filter(pr => pr.state === 'CLOSED').length, open: prs.filter(pr => pr.state === 'OPEN').length};
  // Landing a fixer's PR by hand closes it unmerged with "Landed on main": it counts as landed, not discarded.
  fixer.landed = fixer.merged + prs.filter(pr => pr.state === 'CLOSED' && /Landed on main/i.test(pr.closingNote || '')).length;
  const usd = costs.reduce((sum, item) => sum + (Number(item.usd) || 0), 0);
  const byJob = {};
  for (const item of costs) { const job = String(item.job || 'other').replace(/ .*$/, ''); byJob[job] = Number(((byJob[job] || 0) + (Number(item.usd) || 0)).toFixed(3)); }
  const daily = {};
  for (const issue of issues) {
    const d = day(issue.createdAt); if (!d) continue;
    const row = (daily[d] ??= {day: d, filed: 0, real: 0, falsePositive: 0});
    const kind = classify(issue);
    row.filed++; if (kind === 'fixed' || kind === 'queued') row.real++; if (kind === 'falsePositive') row.falsePositive++;
  }
  const notable = issues.filter(issue => ['fixed', 'queued'].includes(classify(issue))).sort((a, b) => b.number - a.number).slice(0, 15)
    .map(issue => ({number: issue.number, title: String(issue.title || '').replace(/^\[auto-ui\]\s*/, '').slice(0, 110), url: issue.url || '', detector: DETECTORS[detectorOf(issue)] || detectorOf(issue),
      status: classify(issue) === 'fixed' ? 'fixed' : 'queued', severity: (names(issue).find(name => name.startsWith('severity:')) || 'severity:medium').slice(9)}));
  return {schema: SCHEMA, at: new Date(now).toISOString(), totals: {...totals, real, precision: judged ? Math.round(100 * real / judged) : null},
    byDetector: Object.values(by).sort((a, b) => b.filed - a.filed), fixer, verdicts,
    cost: {usd: Number(usd.toFixed(2)), runs: costs.length, byJob, perRealBug: real ? Number((usd / real).toFixed(2)) : null},
    recall: recall && Number.isInteger(recall.planted) ? {planted: recall.planted, caught: recall.caught, missed: (recall.rows || []).filter(row => !row.caught).map(row => row.id)} : null,
    daily: Object.values(daily).sort((a, b) => a.day.localeCompare(b.day)).slice(-30), notable};
}
