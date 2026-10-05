// The trend charts of /self-heal (src/trend.js): what the Finder files each day and how each ended, how often it is right, what its AI costs: inline SVG, hover text, a table view.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {costChart, dayLabel, filedChart, MILESTONES, niceMax, precisionChart, precisionSeries, trendSection, trendTable} from '../src/trend.js';
import {liveSection, page} from '../src/selfheal.js';

const row = (day, filed, real, falsePositive, stale = 0, open = 0) => ({day, filed, real, falsePositive, stale, open});
const history = [row('2026-10-02', 6, 1, 4, 0, 1), row('2026-10-03', 0, 0, 0), row('2026-10-04', 12, 4, 5, 2, 1), row('2026-10-05', 15, 5, 3, 5, 2)];

test('days are labelled plainly and the axis maximum is a round number', () => {
  assert.equal(dayLabel('2026-10-05'), '5 Oct');
  assert.deepEqual([3, 5, 7, 20, 23, 51, 130].map(niceMax), [5, 5, 10, 20, 30, 60, 140]);
});

test('precision is real over real plus false, per day and over the last three days; a day with nothing judged has none of its own', () => {
  const series = precisionSeries(history);
  assert.deepEqual(series.map(item => item.own), [20, null, 44, 63]);
  assert.deepEqual(series.map(item => item.rolling), [20, 20, 36, 53], 'three days together: 1 of 5, then 5 of 14, then 9 of 17');
  assert.deepEqual(precisionSeries([]), []);
});

test('the filed chart stacks real, false, stale and not judged per day, with hover text and a hatch for the unjudged', () => {
  const svg = filedChart(history);
  assert.match(svg, /<svg class="chart" viewBox="0 0 760 230" role="img" aria-label="Issues filed per day, by how they ended">/);
  assert.equal((svg.match(/class="hit"/g) || []).length, 4, 'one hover area per day');
  assert.match(svg, /data-tip="4 Oct: 12 filed — 4 real, 5 false, 2 stale or duplicate, 1 not judged yet \(44% right\)"/);
  assert.match(svg, /data-tip="3 Oct: 0 filed — 0 real, 0 false, 0 stale or duplicate, 0 not judged yet"/);
  assert.match(svg, /<pattern id="hatch"/);
  for (const cls of ['s-real', 's-false', 's-stale', 's-open']) assert.match(svg, new RegExp(`class="${cls}"`), cls);
  assert.match(svg, /<text class="value"[^>]*>15<\/text>/, 'the total above a bar');
});

test('the precision chart marks the dates the rules changed with numbered markers, and draws its line and dots', () => {
  const svg = precisionChart(history);
  assert.equal((svg.match(/class="milestone"/g) || []).length, MILESTONES.filter(item => history.some(day => day.day === item.day)).length);
  assert.match(svg, /<path class="line"/);
  assert.equal((svg.match(/class="dot"/g) || []).length, 3, 'a dot for each day with something judged');
  assert.match(svg, /data-tip="4 Oct: 44% right \(4 real of 9 judged\); the last three days 36% \(14 judged\)"/);
  assert.match(svg, /<text class="value"[^>]*>53%<\/text>/, 'the latest value is labelled');
});

test('the cost chart appears only when there is a cost; the table gives every number again', () => {
  assert.equal(costChart(history, {}), '');
  const svg = costChart(history, {'2026-10-04': 0.45, '2026-10-05': 1.25});
  assert.match(svg, /data-tip="5 Oct: \$1\.25 of AI cost"/);
  const table = trendTable(history, {'2026-10-05': 1.25});
  assert.match(table, /<summary>Table view<\/summary>/);
  assert.match(table, /<td>5 Oct<\/td><td class="n">15<\/td><td class="n">5<\/td><td class="n">3<\/td><td class="n">5<\/td><td class="n">2<\/td><td class="n">63%<\/td><td class="n">\$1\.25<\/td>/);
});

test('the section reads at a glance: a legend, the three charts, the milestones as a list, and an empty state before the first publish', () => {
  const html = trendSection({history, costDays: {'2026-10-05': 1.25}});
  assert.match(html, /How the Finder is evolving/);
  assert.match(html, /Real bug<\/li><li><i class="sw s-false"><\/i>False positive or test mistake/);
  assert.equal((html.match(/<svg class="chart"/g) || []).length, 3);
  assert.equal((html.match(/<ol class="milestones">/g) || []).length, 1);
  assert.match(html, /<b>4 Oct<\/b> · One issue per defect family/);
  assert.match(trendSection({}), /No daily history yet/);
  assert.doesNotMatch(trendSection({history}), /AI costs each day/, 'no cost data: no cost chart');
});

test('the live section and the page carry the section, the tooltip and the colours; a hover text with quotes cannot break out of its attribute', () => {
  const live = {at: '2026-10-05T06:15:46Z', totals: {}, byDetector: [], history, costDays: {}};
  assert.match(liveSection(live, [], new Date('2026-10-05T07:00:00Z')), /How the Finder is evolving/);
  const html = page(undefined, live, []);
  assert.match(html, /<div id="tip" role="tooltip" hidden><\/div><script>/);
  assert.match(html, /--s1:#3987e5;--s2:#d95926;--s3:#199e70/);
  const evil = filedChart([row('2026-10-05', 1, 1, 0)].map(item => ({...item, day: '2026-10-05'})));
  assert.ok(!/data-tip="[^"]*"[^>]*onmouseover/.test(evil));
  assert.doesNotMatch(precisionChart([row('2026-10-05', 1, 1, 0)]), /NaN|undefined/);
  assert.doesNotMatch(filedChart([]), /NaN|undefined/, 'no days: an empty chart, not a crash');
});
