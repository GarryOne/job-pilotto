// Which run's result card is shown next on Actions (#280): each finished run is judged by itself, not against one high-water id.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SHOWN_MAX, unseenRun, withShown} from '../renderer/result-seen.js';

const run = (id, extra = {}) => ({id, endedAt: '2026-10-05T10:30:00Z', ...extra});

test('a search that started earlier but ended later still gets its card after a later-started run was shown', () => {
  const search = run(1000), insight = run(1010);
  let state = {base: 900, shown: []};
  assert.equal(unseenRun([insight, search], state).id, 1010, 'the insight ended first and is shown');
  state = {...state, shown: withShown(state.shown, 1010)};
  assert.equal(unseenRun([insight, search], state).id, 1000, 'the slower search id is smaller than the one shown: it still draws its card');
  state = {...state, shown: withShown(state.shown, 1000)};
  assert.equal(unseenRun([insight, search], state), null, 'both are shown: nothing more');
});

test('what was there at the first start, a run still going, and a run without a card are not news', () => {
  const state = {base: 1000, shown: []};
  assert.equal(unseenRun([run(1000), run(900)], state), null);
  assert.equal(unseenRun([run(1200, {live: true}), run(1201, {endedAt: ''})], state), null);
  assert.equal(unseenRun([run(1300)], state, () => false), null);
});

test('the list of shown ids stays short and never repeats an id', () => {
  assert.deepEqual(withShown([1, 2], 2), [1, 2]);
  const many = Array.from({length: SHOWN_MAX + 20}, (_, i) => i + 1).reduce((shown, id) => withShown(shown, id), []);
  assert.equal(many.length, SHOWN_MAX);
  assert.equal(many.at(-1), SHOWN_MAX + 20);
});
