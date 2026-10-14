// Lab Form Filling's "What we test on" (Coverage tab, top): the sets the lab tests with, how many each holds and its runs in the last 14 days where known. The repo's counts (saved form pages, control-test
// pages) come from CI on main with the replay upload it already does, counted by structure (desktop/e2e/lib/repo-counts.mjs; the site cannot read the repo); the pool and the recorded journeys are the site's own.
// "As of" is the commit and day of the upload the repo counts came from. Guard: site/test/what-we-test.test.js.
import {esc} from './stats.js';

const DAYS = 14;
const since = now => new Date(now.getTime() - (DAYS - 1) * 86400000).toISOString().slice(0, 10);

// replayRuns: the stored CI runs (src/applying-replays.js readReplays); pool: the pool rows; smokeRuns: the smoke runs ({day}); records: the replay-vs-live rows ({recording} set when a newest record exists).
// -> {asOf: {sha, day} | null, rows: [{set, count, what, runs}]} (count/runs null = not reported yet).
export function testSets({replayRuns = [], pool = [], smokeRuns = [], records = [], now = new Date()}) {
  const from = since(now), last = replayRuns.at(-1) || null, withRepo = [...replayRuns].reverse().find(run => run.repo) || null;
  const ciRuns = replayRuns.filter(run => run.at.slice(0, 10) >= from).length;
  return {
    asOf: withRepo ? {sha: withRepo.sha.slice(0, 7), day: withRepo.at.slice(0, 10)} : last ? {sha: last.sha.slice(0, 7), day: last.at.slice(0, 10)} : null,
    rows: [
      {set: 'Pool sites (live rows)', count: pool.length, what: 'real postings opened live, stopped before any account button or Submit; the Pool tab', runs: smokeRuns.filter(run => run.day >= from).length},
      {set: 'Saved form pages', count: withRepo?.repo?.recorded ?? null, what: 'a recorded page replayed offline with the real extension (desktop/e2e/recorded); the page cases', runs: withRepo || last ? ciRuns : null},
      {set: 'Control-test pages', count: withRepo?.repo?.zoo ?? null, what: 'one made-up page per control shape (the widget zoo, desktop/e2e/widget-zoo); a measure, not a gate', runs: null},
      {set: 'Recorded journeys', count: records.filter(item => item.recording).length, what: 'a pool row\'s newest network record, replayed offline end to end (the site replays)', runs: null},
    ],
  };
}

const cell = value => (value == null ? '<span class="muted">–</span>' : String(value));
// The section's inner HTML (bare: the lab page boxes its own sections).
export function whatWeTestSection(model) {
  return `<h2>🧱 What we test on</h2><small class="muted">The sets behind this page, counted by structure${model.asOf ? ` · as of commit ${esc(model.asOf.sha)}, ${esc(model.asOf.day)}` : ' · the repo counts arrive with the next CI run on main'}. Runs are the last ${DAYS} days where known.</small>
<div class="wrap"><table><tr><th>Set</th><th class="n">Count</th><th>What it is</th><th class="n">Runs (${DAYS} days)</th></tr>
${model.rows.map(row => `<tr><td>${esc(row.set)}</td><td class="n">${cell(row.count)}</td><td class="muted">${esc(row.what)}</td><td class="n">${cell(row.runs)}</td></tr>`).join('\n')}</table></div>`;
}
