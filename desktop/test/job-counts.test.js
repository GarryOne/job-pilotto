// Every job count on the Jobs page agrees: the counters, the tooltip and the Find jobs card read one definition (jobCounts in renderer/jobs-view.js).
// 18 Oct 2026: a search said "206 Listed · 203 Scored" over "351 Total matches" because the card counted the loaded (cut) list.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {jobCounts} from '../renderer/jobs-view.js';
import {findCard} from '../renderer/find-card-model.js';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const row = (id, extra = {}) => ({id, url: `https://x.test/${id}`, company: `Co ${id}`, status: 'unreviewed', fit: null, first_seen_at: '2026-09-01', ...extra});
// The store has 12 rows: the list loaded 9 of them (cut), 3 matches (2 scored, one high fit, one new this week) are not loaded.
const loaded = [
  row(1, {fit: 90}), row(2, {fit: 75, first_seen_at: '2026-10-17'}), row(3, {fit: 40}), row(4), row(5, {fit: 55, status: 'dismissed'}),
  row(6, {fit: 80, status: 'applied'}), row(7, {fit: 60, status: 'saved'}),
  row(8, {origin: 'inbound', stage: 'Screening'}), row(9, {expired: true, fit: 30}),
];
const data = {jobs: loaded, total: 12, scored_beyond: 2, high_beyond: 1, week_beyond: 1};

test('the counters count job matches, loaded or not, once', () => {
  const count = jobCounts(data, NOW);
  // matches = loaded rows that are not applications or inbound (7: 1,2,3,4,5,7,9) + the 3 not loaded
  assert.equal(count.total, 10);
  assert.equal(count.scored, 6 + 2, 'loaded matches with a fit (1,2,3,5,7,9) + the 2 scored ones not loaded');
  assert.equal(count.high, 3, 'fit 70+: rows 1, 2 and the one not loaded');
  assert.equal(count.week, 2, 'row 2 and the one not loaded');
});

test('every count is within the total and the card repeats the counters', () => {
  const count = jobCounts(data, NOW);
  assert.ok(count.scored <= count.total && count.high <= count.scored && count.week <= count.total);
  const card = findCard({finishedHere: true, last: {ok: true}, lastSearchAt: 'x', listed: count.total});
  assert.equal(card.listed, count.total, 'a run without a counts line falls back to the list count, the same one');
});

test('a list that is not cut has nothing beyond: total is the matches', () => {
  const count = jobCounts({jobs: loaded, total: loaded.length}, NOW);
  assert.equal(count.total, 7);
  assert.equal(jobCounts({jobs: []}, NOW).total, 0);
  assert.equal(jobCounts(undefined, NOW).total, 0);
});

test('the Find jobs card reads jobCounts, never the loaded list', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../renderer/pages/jobs-find.js', import.meta.url), 'utf8');
  assert.match(source, /jobCounts\(/);
  assert.doesNotMatch(source, /jobs\.length|jobs\.filter/);
});
