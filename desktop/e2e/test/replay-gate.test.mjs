// The offline replay's gate (replay-gate.mjs): only rows 100% same as live in the baseline count; a counted row is worse only when its outcome falls, a fix that
// changes the asks or goes further passes as "different", and a fall the retry does not repeat is noise. Pure: no browser.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fell, judge, summary} from '../replay-gate.mjs';

const form = (filled, left) => ({reached: 'form', filled, left});
const rec = (name, outcome, {hit = 4, asks = 4, extra = 0} = {}) => ({name, outcome, live: {asks}, network: {hit, extra, notRecorded: 0}});
const baseline = {rows: {a: {same: true, outcome: form(8, 4)}, b: {same: true, outcome: form(8, 4)}, c: {same: false, outcome: form(8, 4)}, d: {same: true, outcome: form(8, 4)}}};

test('an outcome falls on an earlier step, fewer filled or more left; a missing number never counts', () => {
  assert.equal(fell(form(8, 4), {reached: 'account', filled: null, left: null}), 'reached account, baseline form');
  assert.equal(fell(form(8, 4), form(7, 4)), 'filled 7, baseline 8');
  assert.equal(fell(form(8, 4), form(8, 5)), 'left 5, baseline 4');
  assert.equal(fell(form(8, 4), form(9, 3)), '');
  assert.equal(fell(form(null, null), form(2, 9)), '');
});

test('only counted rows can be worse; a fix that goes further or only changes the asks passes as different', () => {
  const result = judge([rec('a', form(8, 4)), rec('b', form(6, 6)), rec('c', form(1, 11)), rec('d', form(10, 2), {hit: 2}), rec('new', form(1, 1))], baseline);
  assert.equal(result.rows.a.verdict, 'same');
  assert.equal(result.rows.b.verdict, 'worse');
  assert.equal(result.rows.c.verdict, 'not counted', 'a row not 100% same as live in the baseline never turns the gate red');
  assert.equal(result.rows.d.verdict, 'different');
  assert.match(result.rows.d.why, /further than the baseline: re-record to confirm/);
  assert.equal(result.rows.new.verdict, 'not counted');
  assert.deepEqual([result.counted, result.worse, result.red], [3, 1, true]);
  assert.match(summary(result), /3 of 5 rows counted · 1 worse/);
});

test('a fall the retry does not repeat is noise; a repeated fall stays worse; no baseline is green', () => {
  assert.equal(judge([rec('b', form(6, 6))], baseline, [rec('b', form(8, 4))]).rows.b.verdict, 'noise');
  assert.equal(judge([rec('b', form(6, 6))], baseline, [rec('b', form(6, 6))]).rows.b.verdict, 'worse');
  const first = judge([rec('a', form(8, 4))], {});
  assert.deepEqual([first.counted, first.red], [0, false]);
});
