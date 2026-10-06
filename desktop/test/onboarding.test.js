// Focus → Get started (renderer/onboarding.js): each step ticked from what really happened, in order, and the card gone for good once all are done.
import test from 'node:test';
import assert from 'node:assert/strict';
import {STEPS, onboarding} from '../renderer/onboarding.js';

const run = (kind, id, extra = {}) => ({kind, id, endedAt: id + 1000, ok: true, ...extra});
const applied = n => ({steps: [{step: '📝 Prepared', reached: 3}, {step: '📨 Applied', reached: n}]});

test('a new install: every step to do, Find new employers first', () => {
  const state = onboarding();
  assert.deepEqual(state.steps.map(step => step.key), ['scout', 'search', 'notion', 'tailor', 'apply']);
  assert.equal(state.next.key, 'scout');
  assert.equal(state.show, true);
  assert.equal(state.doneCount, 0);
});

test('a search counts only after the employers were found; failed or running runs do not count', () => {
  assert.equal(onboarding({runs: [run('search', 100)]}).steps[1].done, false);                      // searched, but no employers found yet
  assert.equal(onboarding({runs: [run('scout', 200), run('search', 100)]}).steps[1].done, false);   // the search was before
  assert.equal(onboarding({runs: [run('scout', 100), run('search', 200)]}).steps[1].done, true);
  assert.equal(onboarding({runs: [run('scout', 100, {ok: false})]}).steps[0].done, false);
  assert.equal(onboarding({runs: [run('scout', 100, {live: true})]}).steps[0].done, false);
  assert.equal(onboarding({settings: {lastScoutAt: '2026-10-06T20:00:00Z'}}).steps[0].done, true);   // its run left the history: the setting remembers
});

test('every step has a way to be ticked, and once all are, the card is gone for good', () => {
  const runs = [run('scout', 100), run('search', 200), run('tailor', 300)];
  const state = onboarding({runs, notionConnected: true, funnel: applied(1)});
  assert.equal(state.allDone, true);
  assert.equal(state.show, false);
  assert.deepEqual(state.remember, {scout: true, search: true, notion: true, tailor: true, apply: true, done: true});
  // Later nothing is in the history and Notion is disconnected: still gone, no step comes back.
  const later = onboarding({settings: {onboarding: state.remember}});
  assert.equal(later.show, false);
  assert.ok(later.steps.every(step => step.done));
  assert.deepEqual(later.remember, {});
  assert.equal(STEPS.length, state.steps.length);
});

test('Hide keeps it hidden; a step done is remembered at once', () => {
  assert.equal(onboarding({settings: {onboarding: {hidden: true}}}).show, false);
  assert.deepEqual(onboarding({notionConnected: true}).remember, {notion: true});
  assert.equal(onboarding({funnel: applied(0)}).steps[4].done, false);
});
