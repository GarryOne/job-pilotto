// The Focus suite's oracle must be right before the page is judged by it, and the comparison must be able to fail.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EXPECTED_UP_NEXT, compareNumbers, eventProperties, expectedNumbers, rowProperties, scenario, zurichAt, zurichDay} from '../lib/focus-data.mjs';

const NOW = new Date('2026-10-02T09:30:00Z');
// The scenario as the Notion API would return it.
function apiPages(now = NOW) {
  const data = scenario(now);
  const page = (id, properties) => ({id, archived: false, properties: Object.fromEntries(Object.entries(properties).map(([name, value]) => [name, withType(value)]))});
  const rows = data.rows.map(({key, fields}) => page(`row-${key}`, rowProperties(fields)));
  const events = data.events.map(item => page(`event-${item.rowKey}-${item.kind}`, eventProperties(item, data.rows.find(r => r.key === item.rowKey).fields, `row-${item.rowKey}`)));
  return {rows, events};
}
function withType(value) {   // what the API adds: a `type` per property
  const type = ['title', 'rich_text', 'select', 'date', 'number', 'url', 'relation'].find(name => name in value);
  return {type, ...value};
}

test('the scenario gives the numbers the product spec promises', () => {
  const {rows, events} = apiPages();
  const want = expectedNumbers(rows, events, {now: NOW, target: 5});
  assert.equal(want.applied, 2, 'Delta Grid and Ibis Analytics were applied to today');
  assert.equal(want.pctText, '40%');
  assert.equal(want.chartSum, '5 applied · 0 days on target', 'Fjord (14 days ago) is outside the 14-day chart');
  assert.deepEqual(want.funnel.map(step => [step.name, step.reached]), [['Prepared', 8], ['Applied', 6], ['Human reply', 2], ['Screening', 2], ['Interviews', 0]]);
  assert.deepEqual(want.inbound.map(step => [step.name, step.reached]), [['Contacted you', 2], ['Screening', 1], ['Interviews', 1], ['Offers', 0]]);
  assert.equal(want.kits, 2);
});
test('a different target changes the ratio, not the count', () => {
  const {rows, events} = apiPages();
  const want = expectedNumbers(rows, events, {now: NOW, target: 3});
  assert.equal(want.applied, 2);
  assert.equal(want.pctText, '67%');
  assert.equal(want.ofText, '/ 3 applications today');
});
test('a day that reached the target is counted on target', () => {
  const {rows, events} = apiPages();
  assert.match(expectedNumbers(rows, events, {now: NOW, target: 2}).chartSum, /1 day on target/);
});
test('the comparison passes the right page and names every wrong number', () => {
  const {rows, events} = apiPages();
  const want = expectedNumbers(rows, events, {now: NOW, target: 5});
  const right = {count: '2', of: '/ 5 applications today', pct: '40%', bar: '40%', chartSum: want.chartSum,
    funnel: want.funnel.map(step => ({name: step.name, count: String(step.reached), share: `${step.share}% reached`})),
    inbound: want.inbound.map(step => ({name: step.name, count: String(step.reached), share: `${step.share}% reached`}))};
  assert.deepEqual(compareNumbers(right, want), []);
  const broken = structuredClone(right);
  broken.count = '3'; broken.funnel[1].count = '7'; broken.inbound[0].share = '90% reached'; broken.bar = '50%';
  const diffs = compareNumbers(broken, want);
  assert.equal(diffs.length, 4, diffs.join('\n'));
  assert.ok(diffs.some(d => /applications today.*"3".*"2"/.test(d)) && diffs.some(d => /"Applied" count/.test(d)));
});
test('a missing step is a difference, not a crash', () => {
  const {rows, events} = apiPages();
  const want = expectedNumbers(rows, events, {now: NOW});
  const shown = {count: '2', of: want.ofText, pct: want.pctText, bar: '40%', chartSum: want.chartSum, funnel: [], inbound: []};
  assert.ok(compareNumbers(shown, want).length >= 2);
});
test('the oracle refuses a row without an Origin instead of guessing', () => {
  const {rows, events} = apiPages();
  delete rows[0].properties.Origin;
  assert.throws(() => expectedNumbers(rows, events, {now: NOW}), /explicit Origin/);
});
test('Zurich days and offsets follow daylight saving', () => {
  assert.equal(zurichDay('2026-10-02T22:30:00Z'), '2026-10-03', '00:30 in Zurich is already the next day');
  assert.equal(zurichAt('2026-10-03', '10:00'), '2026-10-03T10:00:00+02:00');
  assert.equal(zurichAt('2026-10-30', '10:00'), '2026-10-30T10:00:00+01:00');
});
test('every Up next row names a button list', () => {
  assert.equal(EXPECTED_UP_NEXT.length, 6);
});
