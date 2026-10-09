// Who gets a learned item while it is a canary (src/canary-reach.js): its rollout share, and every beta install (owner, 9 Oct 2026: with
// one or two installs a 5% bucket may hold no one, so a canary was never used and never judged).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bucketOf} from '../../extension/recipe-schema.js';
import {betaOf, reaches} from '../src/canary-reach.js';
import {LEARNING_CRON, judgeLearning} from '../src/index.js';

const outside = Array.from({length: 200}, (_, i) => `install-${i}`).find(id => bucketOf(id) >= 5);   // an install outside a 5% canary

test('a canary reaches its rollout share and every beta install; verified reaches all; disabled none', () => {
  assert.equal(reaches({status: 'canary', rollout: 5}, outside), false);
  assert.equal(reaches({status: 'canary', rollout: 5}, outside, true), true);
  assert.equal(reaches({status: 'verified', rollout: 0}, outside), true);
  assert.equal(reaches({status: 'disabled', rollout: 100}, outside, true), false);
  assert.equal(reaches({status: 'candidate', rollout: 0}, outside, true), false);
  assert.equal(betaOf(new Request('https://x/', {headers: {'X-Beta': '1'}})), true);
  assert.equal(betaOf(new Request('https://x/')), false);
});

test('the hourly trigger runs only the learning judges', async () => {
  const calls = [];
  const db = {prepare: sql => ({bind: () => ({all: async () => { calls.push(sql); return {results: []}; }, first: async () => null, run: async () => ({})}),
    all: async () => { calls.push(sql); return {results: []}; }})};
  assert.equal(LEARNING_CRON, '15 * * * *');
  assert.deepEqual(await judgeLearning(db), {recipes: [], meanings: [], aliases: []});
  assert.ok(calls.some(sql => /FROM recipes/.test(sql)) && calls.some(sql => /FROM aliases/.test(sql)) && calls.some(sql => /FROM meanings/.test(sql)));
});
