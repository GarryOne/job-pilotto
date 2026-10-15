// Guards e2e/lib/ladder-spread.mjs: which ladder fixtures flip between model draws, the label on them, and the noisy/steady split of the wrong-confident list.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fingerprintKey, labelOf, measureEntry, splitNoisy, summaryLines} from '../e2e/lib/ladder-spread.mjs';

const draw = (outcome, status = 'exact') => ({outcome, status});
const FP = 'aaaa', OLD = 'bbbb';

test('measureEntry: counts the draws that gave the stored outcome and whether any was wrong and confident', () => {
  assert.deepEqual(measureEntry('form', [draw('form'), draw('form'), draw('form')], FP), {draws: 3, same: 3, wrongConfident: false, fp: FP});
  assert.deepEqual(measureEntry('form', [draw('form'), draw('account', 'wrong-confident'), draw('form')], FP), {draws: 3, same: 2, wrongConfident: true, fp: FP});
});

test('labelOf: a fixture that flips is "noisy (k/n)"; a steady one and an unknown one have no label; an older fingerprint says so', () => {
  const spread = {fixtures: {flip: {draws: 3, same: 1, wrongConfident: false, fp: FP}, steady: {draws: 3, same: 3, wrongConfident: false, fp: FP}, old: {draws: 3, same: 2, wrongConfident: true, fp: OLD}}};
  assert.equal(labelOf('flip', spread, FP), 'noisy (1/3)');
  assert.equal(labelOf('steady', spread, FP), '');
  assert.equal(labelOf('unknown', spread, FP), '');
  assert.equal(labelOf('old', spread, FP), 'noisy (2/3, spread from the previous prompt)');
});

test('splitNoisy: the wrong-confident rows apart into known-to-flip and steady', () => {
  const spread = {fixtures: {a: {draws: 3, same: 2, wrongConfident: true, fp: FP}, b: {draws: 3, same: 3, wrongConfident: false, fp: FP}}};
  const split = splitNoisy([{id: 'a'}, {id: 'b'}, {id: 'c'}], spread, FP);
  assert.deepEqual(split.noisy.map(row => row.id), ['a']);
  assert.deepEqual(split.steady.map(row => row.id), ['b', 'c']);
});

test('summaryLines: "of the N new wrong-confident, M are known to flip"; a jump of only noisy ones is called noise', () => {
  const spread = {fixtures: {a: {draws: 3, same: 2, wrongConfident: true, fp: FP}, b: {draws: 3, same: 1, wrongConfident: true, fp: FP}}};
  const baseline = {fixtures: {a: {status: 'exact'}, b: {status: 'exact'}, c: {status: 'wrong-confident'}}};
  const rows = [{id: 'a', status: 'wrong-confident'}, {id: 'b', status: 'wrong-confident'}, {id: 'c', status: 'wrong-confident'}];
  const text = summaryLines(rows, spread, baseline, FP).join('\n');
  assert.match(text, /Of the 2 new wrong-confident, 2 are known to flip/);
  assert.match(text, /noise/);
  const real = summaryLines([...rows, {id: 'd', status: 'wrong-confident'}], spread, {fixtures: {...baseline.fixtures, d: {status: 'exact'}}}, FP).join('\n');
  assert.match(real, /Of the 3 new wrong-confident, 2 are known to flip/);
  assert.match(real, /steady.*d/);
});

test('fingerprintKey: one stable key per prompt set, different when one prompt changes', () => {
  assert.equal(fingerprintKey({x: '1', y: '2'}), fingerprintKey({y: '2', x: '1'}));
  assert.notEqual(fingerprintKey({x: '1', y: '2'}), fingerprintKey({x: '1', y: '3'}));
});
