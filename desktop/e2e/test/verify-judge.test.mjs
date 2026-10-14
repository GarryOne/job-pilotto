// Verdicts of "Confirmed offline" (lib/verify-judge.mjs): a fix is confirmed only by two agreeing on-recording replays whose control holds; everything else says "Needs a recording". Pure: no browser.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildOf, compare, judgeFixed, judgeRegression} from '../lib/verify-judge.mjs';

const form = (filled, left) => ({reached: 'form', filled, left});
const rec = (outcome, liveOutcome, {hit = 4, asks = 4, extra = 0, notRecorded = 0} = {}) => ({outcome, liveOutcome, live: {asks}, network: {hit, extra, notRecorded}});
const stuck = {reached: 'account', filled: null, left: null};
const control = rec(stuck, stuck);
const fixed = {recordedAt: '2026-10-12T10:00:00Z', landedAt: '2026-10-13T10:00:00Z', control};

test('compare: a later step, more filled or fewer left is further; a missing side is null', () => {
  assert.equal(compare(form(5, 5), stuck), 1);
  assert.equal(compare(form(5, 5), form(5, 5)), 0);
  assert.equal(compare(form(4, 6), form(5, 5)), -1);
  assert.equal(compare(null, stuck), null);
});

test('a fix is confirmed by two agreeing on-recording replays that go further than live', () => {
  const run = rec(form(8, 2), stuck);
  assert.equal(judgeFixed({...fixed, runs: [run, run]}).verdict, 'confirmed');
});

test('every other case says live or not better, never confirmed', () => {
  const run = rec(form(8, 2), stuck), same = rec(stuck, stuck), post = rec({reached: 'posting'}, stuck), cases = {
    'one replay': [[run], 'live'],
    'two replays disagree': [[run, rec(form(3, 7), stuck)], 'live'],
    'the build asks what the recording lacks': [[run, rec(form(8, 2), stuck, {extra: 1})], 'live'],
    'a site request not recorded': [[run, rec(form(8, 2), stuck, {notRecorded: 1})], 'live'],
    'ends where live did': [[same, same], 'notbetter'],
    'goes less far': [[post, post], 'notbetter']};
  for (const [name, [runs, verdict]] of Object.entries(cases)) assert.equal(judgeFixed({...fixed, runs}).verdict, verdict, name);
  assert.equal(judgeFixed({...fixed, runs: [run, run], control: rec(form(8, 2), stuck)}).verdict, 'live', 'the control replays to another outcome than live');
  assert.equal(judgeFixed({...fixed, runs: [run, run], control: null}).verdict, 'live', 'no control');
  assert.equal(judgeFixed({...fixed, runs: [run, run], recordedAt: '2026-10-14T00:00:00Z'}).verdict, 'live', 'recorded after the fix');
  assert.equal(judgeFixed({...fixed, runs: [run, run], recordedAt: null}).verdict, 'live', 'no recording');
});

test('a regression: the older build going further on the same recording is ours; the same stop is the site; off the recording is live', () => {
  const further = rec(form(8, 2), stuck), also = rec(stuck, stuck);
  assert.equal(judgeRegression({control, runs: [further, further]}).verdict, 'ours');
  assert.equal(judgeRegression({control, runs: [also, also]}).verdict, 'site');
  assert.equal(judgeRegression({control, runs: [further, rec(form(8, 2), stuck, {hit: 3, extra: 1})]}).verdict, 'live');
  assert.equal(judgeRegression({control: null, runs: [further, further]}).verdict, 'live');
});

test('a recording builds from its stamped version, else from the time it was made', () => {
  const versions = [{version: '0.9.10', hash: 'aaa', at: '2026-10-10T00:00:00Z'}, {version: '0.9.11', hash: 'ccc', at: '2026-10-12T00:00:00Z'}];
  const commits = [{hash: 'aaa', at: '2026-10-10T00:00:00Z'}, {hash: 'bbb', at: '2026-10-11T00:00:00Z'}, {hash: 'ccc', at: '2026-10-12T00:00:00Z'}, {hash: 'ddd', at: '2026-10-13T00:00:00Z'}];
  const startMs = Date.parse('2026-10-11T12:00:00Z');
  assert.deepEqual(buildOf({log: 'x "version":"0.9.10" y', startMs, versions, commits}), {commit: 'bbb', by: 'version'});
  assert.deepEqual(buildOf({log: 'no stamp', startMs, versions, commits}), {commit: 'bbb', by: 'time'});
  assert.equal(buildOf({log: '', startMs: Date.parse('2026-01-01'), versions, commits}), null);
});
