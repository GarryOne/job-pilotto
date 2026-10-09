// Focus → Get started (renderer/onboarding.js): each step ticked from what really happened, in order, and the card gone for good once all are done.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {STEPS, focusMode, onboarding} from '../renderer/onboarding.js';

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

// A search's result suggests Find new employers when it can't have found much yet (owner, 6 Oct 2026), and stays quiet otherwise.
test('a search suggests Find new employers when none ever ran or too few employer sites were read', async () => {
  const {employersAdvice, ENOUGH_FEEDS} = await import('../renderer/onboarding.js');
  const search = (extra = {}) => ({kind: 'search', id: 5, endedAt: 6, ok: true, ...extra});
  assert.match(employersAdvice(search({feeds: 192})).text, /hasn’t run yet/);                                  // never: whatever the count
  assert.match(employersAdvice(search({feeds: 1}), {runs: [run('scout', 1)]}).text, /^Only 1 employer site searched/);
  assert.equal(employersAdvice(search({feeds: ENOUGH_FEEDS}), {settings: {lastScoutAt: '2026-10-06T20:00:00Z'}}), null);
  assert.equal(employersAdvice(search(), {runs: [run('scout', 1)]}), null);                                        // count unknown: no claim
  assert.equal(employersAdvice(search({live: true})), null);
  assert.equal(employersAdvice(search({ok: false})), null);                                                         // a failed search says why it failed instead
  assert.equal(employersAdvice({kind: 'mail', id: 1, ok: true}), null);
});

// Fresh after setup, no Notion: Focus is Get started (its own step connects Notion), not the Connect card (owner, 9 Oct 2026).
test('Focus: all of it with Notion; only Get started without; the gate once Get started is hidden', () => {
  const fresh = onboarding({settings: {}, notionConnected: false});
  assert.equal(focusMode({notionConnected: false, gettingStarted: fresh.show}), 'started');
  assert.ok(fresh.steps.some(step => step.key === 'notion' && !step.done));   // connecting stays one step away
  assert.equal(focusMode({notionConnected: true, gettingStarted: true}), 'full');
  const hidden = onboarding({settings: {onboarding: {hidden: true}}, notionConnected: false});
  assert.equal(focusMode({notionConnected: false, gettingStarted: hidden.show}), 'locked');
});

test('data kept on this Mac: the Notion step is done in its own words, and Focus is whole', () => {
  const state = onboarding({keptOnMac: true});
  const step = state.steps.find(each => each.key === 'notion');
  assert.equal(step.done, true);
  assert.equal(step.label, 'Keep your data on this Mac');
  assert.equal(onboarding({notionConnected: true}).steps.find(each => each.key === 'notion').label, 'Connect Notion');
});

test('the window locks a page only while trying, never because Notion is absent (one rule: tracking())', () => {
  const dir = path.join(import.meta.dirname, '..', 'renderer', 'pages');
  const gate = fs.readFileSync(path.join(dir, 'notion-connect.js'), 'utf8');
  assert.match(gate, /const locked = !tracking\(\);/);
  assert.match(gate, /shared\.state\?\.store\?\.trying === false/);
});
