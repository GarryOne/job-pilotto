// Who gets a learned item while it is a canary (src/canary-reach.js): its rollout share, and every beta install (owner, 9 Oct 2026: with
// one or two installs a 5% bucket may hold no one, so a canary was never used and never judged).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bucketOf} from '../../extension/recipe-schema.js';
import {betaOf, reaches, staged} from '../src/canary-reach.js';
import {JUDGE_EVERY_MS, _resetJudge, judgeLearning, judgeSoon} from '../src/index.js';

const outside = Array.from({length: 200}, (_, i) => `install-${i}`).find(id => bucketOf(id) >= 5);   // an install outside a 5% canary

test('staged (switch on): a canary reaches its rollout share and every beta install; verified reaches all; disabled none', () => {
  const on = {stage: true};
  assert.equal(reaches({status: 'canary', rollout: 5}, outside, on), false);
  assert.equal(reaches({status: 'canary', rollout: 5}, outside, {...on, beta: true}), true);
  assert.equal(reaches({status: 'verified', rollout: 0}, outside, on), true);
  assert.equal(reaches({status: 'disabled', rollout: 100}, outside, {...on, beta: true}), false);
  assert.equal(reaches({status: 'candidate', rollout: 0}, outside, {...on, beta: true}), false);
});

// Owner, 9 Oct 2026: the staged rollout is off for now (few installs); valid learning reaches everyone, the kill switch still works.
test('switch off (the default): a canary reaches every install; disabled and candidates still reach no one', () => {
  assert.equal(staged({}), false);
  assert.equal(staged({LEARNING_CANARY: 'on'}), true);
  assert.equal(reaches({status: 'canary', rollout: 5}, outside), true);
  assert.equal(reaches({status: 'disabled', rollout: 100}, outside), false);
  assert.equal(reaches({status: 'candidate', rollout: 0}, outside), false);
  assert.equal(betaOf(new Request('https://x/', {headers: {'X-Beta': '1'}})), true);
  assert.equal(betaOf(new Request('https://x/')), false);
});

test('the learning judges run when fill data arrives, at most once an hour; they judge recipes, aliases and meanings', async () => {
  const calls = [];
  const db = {prepare: sql => ({bind: () => ({all: async () => { calls.push(sql); return {results: []}; }, first: async () => null, run: async () => ({})}),
    all: async () => { calls.push(sql); return {results: []}; }})};
  assert.deepEqual(await judgeLearning(db), {recipes: [], meanings: [], aliases: []});
  assert.ok(calls.some(sql => /FROM recipes/.test(sql)) && calls.some(sql => /FROM aliases/.test(sql)) && calls.some(sql => /FROM meanings/.test(sql)));
  _resetJudge();
  const waited = [], ctx = {waitUntil: p => waited.push(p)};
  assert.equal(judgeSoon({STATS: db}, ctx, Date.UTC(2026, 9, 9)), true);
  assert.equal(judgeSoon({STATS: db}, ctx, Date.UTC(2026, 9, 9) + JUDGE_EVERY_MS - 1), false);   // within the hour: not again
  assert.equal(judgeSoon({STATS: db}, ctx, Date.UTC(2026, 9, 9) + JUDGE_EVERY_MS), true);
  assert.equal(waited.length, 2);
  await Promise.all(waited);
});
