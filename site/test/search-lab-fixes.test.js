// The Lab's "Needs a fix" and "Fixed" tabs (src/search-lab-fixes.js): an episode is a run of bad results (FAILED, Worse, stale tape) after a good run; still going = Needs a fix, ended by a good run = Fixed.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {allEpisodes, episodes, fixedSection, needsSection} from '../src/search-lab-fixes.js';
import {page} from '../src/search-lab-page.js';

const SHA = n => String(n).padStart(40, 'a');
const run = (candidate, n, more = {}) => ({candidate, label: candidate.toUpperCase(), run_at: `2026-10-${String(10 + n).padStart(2, '0')}T10:00:00Z`, build: SHA(n), state: 'ok', first_s: 40, tenth_s: 90, fit_s: 300, in_places: 50, scored: 40, fit70: 5, ...more});

test('an episode starts at the first bad run after a good one and ends at the next good run', () => {
  const list = [run('a', 1), run('a', 2, {fit70: 2}), run('a', 3, {state: 'failed', failed_step: 'Reading job boards'}), run('a', 4), run('a', 5, {state: 'stale', failed_step: 'Tape stale (4 AI and 9 web requests not recorded)'})];
  const found = episodes(list);
  assert.equal(found.length, 2);
  assert.deepEqual([found[0].kind, found[0].runs, found[0].start.build, found[0].end.build, found[0].green.build], ['failed', 2, SHA(2), SHA(4), SHA(1)], 'worse then failed is one episode, shown as its worst kind');
  assert.deepEqual([found[1].kind, found[1].end], ['stale', null], 'the stale tape is still open');
  assert.ok(found[0].why[0].includes('a step crashed'));
});

test('a good run is never an episode, and the first run with no green behind it can still FAIL', () => {
  assert.deepEqual(episodes([run('a', 1), run('a', 2)]), []);
  assert.equal(episodes([run('a', 1, {state: 'failed', failed_step: 'x'})])[0].green, null);
});

test('Needs a fix lists the open ones with a compare link, Fixed the ended ones, and both are tabs of the page', () => {
  const rows = [run('a', 1), run('a', 2, {fit70: 1}), run('b', 1), run('b', 2, {state: 'failed', failed_step: 'Reading job boards'}), run('b', 3), run('c', 1), run('c', 2, {state: 'stale', failed_step: 'Tape stale (4 AI and 9 web requests not recorded)'})];
  assert.equal(allEpisodes(rows).length, 3);
  const needs = needsSection(rows, new Date('2026-10-14T10:00:00Z'));
  assert.match(needs, /A <span class="state bad">Worse<\/span>/);
  assert.match(needs, /C <span class="state wait">Tape stale<\/span>/);
  assert.ok(!needs.includes('B <span'), 'a fixed problem is not open');
  assert.ok(needs.includes(`compare/${SHA(1)}...${SHA(2)}`), 'last good build ... first bad build');
  assert.match(needs, /Need a fix<\/span><b>2<\/b>/);
  const fixed = fixedSection(rows);
  assert.match(fixed, /<b>B<\/b>/);
  assert.ok(!fixed.includes('<b>A</b>'));
  assert.match(fixed, /Fixed<\/span><b class="up">1<\/b>/);
  assert.match(fixed, /Median time to fix<\/span><b>24 h<\/b>/, 'B was bad from day 2 to day 3');
  assert.match(page(rows, [], 'needs'), /href="\?tab=needs"[^>]*>Needs a fix/);
  assert.match(page(rows, [], 'fixed'), /Problems that ended/);
  assert.match(needsSection([run('a', 1)]), /Nothing: every candidate/);
  assert.match(fixedSection([run('a', 1)]), /Nothing fixed yet/);
});
