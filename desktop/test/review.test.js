// The form page's ring and the session page, in step (lib/review.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as review from '../lib/review.js';

const sessions = [
  {id: 's1', url: 'https://www.anthropic.com/jobs/4567890', company: 'Anthropic', startedAt: '2026-09-29T00:20:00Z'},
  {id: 's2', url: 'https://n26.com/en/careers/positions/7012345', company: 'N26', startedAt: '2026-09-29T00:10:00Z'},
];
const form = (extra = {}) => ({url: 'https://job-boards.greenhouse.io/anthropic/jobs/4567890', title: 'Job Application for Staff+ Engineer at Anthropic',
  left: 3, total: 20, watch: [], ...extra});

test('a form page is matched to its session by the job ID, the company, or neither', () => {
  assert.equal(review.matchSession(sessions, form()).id, 's1');
  assert.equal(review.matchSession(sessions, {url: 'https://job-boards.greenhouse.io/n26/jobs/999', title: 'Job Application for SRE at N26'}).id, 's2');
  assert.equal(review.matchSession(sessions, {url: 'https://news.ycombinator.com/', title: 'Hacker News'}), null);
});

test('the page learns what to watch, reports it back, and the session page hears about changes only', () => {
  review._reset();
  const heard = [];
  review.setReporter(state => heard.push(state));
  review.setWatch('s1', [{id: 'w1', label: 'AI Policy for Application'}, {id: 'w2', label: 'Agreement to Arbitrate'}]);
  let reply = review.report(sessions, form());
  assert.equal(reply.matched, 's1');
  assert.deepEqual(Object.keys(reply.session).sort(), ['company', 'id', 'live', 'note', 'status', 'title', 'url']);  // no answers, no question text
  assert.deepEqual(reply.watch.map(item => item.label), ['AI Policy for Application', 'Agreement to Arbitrate']);
  assert.deepEqual(heard.map(state => [state.left, state.ready]), [[3, false]]);
  review.report(sessions, form());  // nothing changed: not passed on again
  assert.equal(heard.length, 1);
  review.report(sessions, form({left: 2, watch: [{id: 'w1', filled: true}, {id: 'w2', filled: false}, {id: 'w3', filled: null}]}));
  assert.deepEqual(heard.at(-1).states, {w1: true, w2: false});  // a field not found on the page (null) says nothing
  review.report(sessions, form({left: 0, watch: [{id: 'w1', filled: true}, {id: 'w2', filled: true}]}));
  assert.equal(heard.at(-1).ready, true);
  assert.equal(review.report(sessions, form({left: 0, total: 0})).matched, 's1');
  assert.equal(heard.at(-1).ready, false);  // no required field seen: never "ready"
});

test('"show me this field" reaches the matching page once, and expires', () => {
  review._reset();
  review.queueFocus('s1', 'Agreement to Arbitrate', 1000);
  assert.deepEqual(review.report(sessions, {url: 'https://job-boards.greenhouse.io/n26/jobs/1', title: 'N26'}, 2000).commands, []);  // another job's page
  assert.deepEqual(review.report(sessions, form(), 2000).commands, [{focus: 'Agreement to Arbitrate'}]);
  assert.deepEqual(review.report(sessions, form(), 3000).commands, []);  // taken
  review.queueFocus('s1', 'Old', 0);
  assert.deepEqual(review.report(sessions, form(), 10 * 60 * 1000).commands, []);  // too old
});

test('"show me this field": the app learns whether a form page took it, or that none did', async () => {
  review._reset();
  review.queueFocus('s1', 'Agreement to Arbitrate');
  const taken = review.delivered('s1', 2000);
  review.report(sessions, form());  // the page's next report picks it up
  assert.equal(await taken, true);
  review.queueFocus('s2', 'Privacy');
  assert.equal(await review.delivered('s2', 30), false);  // no page with the extension answered
});
