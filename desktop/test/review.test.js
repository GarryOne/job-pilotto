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

test('"reload that page" reaches the panel of the matching page once, and expires', () => {
  review._reset();
  review.queueReload('s1', 1000);
  assert.deepEqual(review.report(sessions, {url: 'https://news.ycombinator.com/', title: 'Hacker News'}, 2000).commands, []);  // another page
  assert.deepEqual(review.report(sessions, form(), 2000).commands, [{reload: true}]);
  assert.deepEqual(review.report(sessions, form(), 3000).commands, []);  // taken
  review.queueReload('s1', 0);
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

test('"close this form" reaches the matching page once, and the app hears that it was taken', async () => {
  review._reset();
  review.queueClose('s1');
  const taken = review.delivered('s1', 2000);
  assert.deepEqual(review.report(sessions, form()).commands, [{close: true}]);
  assert.equal(await taken, true);
  assert.deepEqual(review.report(sessions, form()).commands, []);
});

test('a window that just loaded gets every form\'s last state (they are passed on only when they change)', () => {
  review._reset();
  const heard = [];
  review.setReporter(state => heard.push(state));
  review.setWatch('s1', [{id: 'w1', label: 'AI Policy for Application'}]);
  review.report(sessions, form({left: 0, watch: [{id: 'w1', filled: true}]}));
  review.report(sessions, form({left: 0, watch: [{id: 'w1', filled: true}]}));  // unchanged: not passed on again…
  assert.equal(heard.length, 1);
  const all = review.allStates();  // …but a reloaded window asks, and gets it
  assert.deepEqual(all.map(state => [state.id, state.ready, state.states]), [['s1', true, {w1: true}]]);
});

test('the last form states are saved and come back after a restart (only for sessions that still exist)', async () => {
  const {mkdtempSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');
  const file = `${mkdtempSync(`${tmpdir()}/review-`)}/review-states.json`;
  review._reset();
  review.persist(file);
  review.report(sessions, form({left: 0, total: 14}));
  review._reset();
  review.persist(file, ['s1']);
  assert.deepEqual(review.allStates().map(state => [state.id, state.ready]), [['s1', true]]);
  review._reset();
  review.persist(file, ['s2']);
  assert.deepEqual(review.allStates(), []);
});

test('each filled field is ticked off with the time it was first seen, and keeps that time', () => {
  review._reset();
  const heard = [];
  review.setReporter(state => heard.push(state));
  review.report(sessions, form({filled: ['First name'], busy: true}), 1000);  // already filled when first heard of: no time
  review.report(sessions, form({left: 2, filled: ['First name', 'Email'], busy: true}), 3000);
  review.report(sessions, form({left: 1, filled: ['First name', 'Email', 'Phone'], over: true}), 5000);  // after the fill: you
  assert.deepEqual(heard.at(-1).filled, [{label: 'First name', at: null, by: 'fill'}, {label: 'Email', at: 3000, by: 'fill'},
    {label: 'Phone', at: 5000, by: 'you'}]);
  review.report(sessions, form({left: 1, filled: ['First name', 'Email', 'Phone'], over: true}), 9000);  // nothing new: not passed on again
  assert.equal(heard.length, 3);
  review.report(sessions, form({left: 3, filled: ['First name']}), 9500);  // emptied again: off the list
  assert.deepEqual(heard.at(-1).filled.map(item => item.label), ['First name']);
});

test('a waiting "show me this field" names the open tab to join, and no other tab', () => {
  review._reset();
  assert.deepEqual(review.tabsToArm(sessions, [{url: 'https://job-boards.greenhouse.io/anthropic/jobs/4567890', title: 'Anthropic'}]), []);
  review.queueFocus('s1', 'Agreement to Arbitrate', 1000);
  assert.deepEqual(review.tabsToArm(sessions, [
    {url: 'https://news.ycombinator.com/', title: 'Hacker News'},
    {url: 'https://job-boards.greenhouse.io/anthropic/jobs/4567890#jobpilotto-fill', title: 'Job Application for Staff+ Engineer at Anthropic'},
  ], 2000), ['https://job-boards.greenhouse.io/anthropic/jobs/4567890']);
  review.report(sessions, form(), 2000);  // the page took the command: nothing left to join
  assert.deepEqual(review.tabsToArm(sessions, [{url: 'https://job-boards.greenhouse.io/anthropic/jobs/4567890', title: 'Anthropic'}], 2000), []);
});

test('the page says whether it found the field, including when it looked before anyone waited', async () => {
  review._reset();
  review.queueFocus('s1', 'Agreement to Arbitrate');
  assert.equal(review.noteFocus(sessions, {url: 'https://news.ycombinator.com/', title: 'Hacker News', found: true}).ok, false);
  const waiting = review.focusFound('s1', 2000);
  assert.equal(review.noteFocus(sessions, {url: form().url, title: form().title, found: false}).ok, true);
  assert.equal(await waiting, false);
  review.queueFocus('s1', 'Again');  // a new ask forgets the previous answer
  assert.equal(review.noteFocus(sessions, {url: form().url, title: form().title, found: true}).id, 's1');
  assert.equal(await review.focusFound('s1', 50), true);
});

test('what is left comes as the ring counts it, and an older extension sends no filled list at all', () => {
  review._reset();
  const heard = [];
  review.setReporter(state => heard.push(state));
  review.report(sessions, form({left: 1, missing: [], pending: ['Additional Information'], filled: ['Email']}), 1000);
  assert.deepEqual(heard.at(-1).pending, ['Additional Information']);  // an emptied answer Claude wrote, not required
  review._reset();
  review.setReporter(state => heard.push(state));
  review.report(sessions, form({left: 1, missing: []}), 2000);  // 0.8.11: no "filled", no "pending"
  assert.equal(heard.at(-1).filled, undefined);  // unknown, not "0 filled"
  assert.equal(heard.at(-1).pending, undefined);
});

test('a session\'s form is its newest tab: an older tab for the same job answers nothing and does not hide a closed form', () => {
  review._reset();
  review.noteTabs({ids: [10, 40], boot: 'run1'});
  review.queueFocus('s1', 'Resume');
  assert.equal(review.tabOpen('s1'), null);                              // no tab seen yet
  assert.equal(review.report(sessions, form({tab: 40})).matched, 's1');  // the new tab
  const old = review.report(sessions, form({tab: 10}));                  // a leftover tab, polling too
  assert.deepEqual([old.matched, old.commands.length], [null, 0]);       // it gets nothing, and the focus command stays queued
  assert.equal(review.tabOpen('s1'), true);
  review.noteTabs({ids: [10], boot: 'run1'});                            // the new tab was closed, the old one is still there
  assert.equal(review.tabOpen('s1'), false);
  review.noteTabs({ids: [3], boot: 'run2'});                             // Chrome restarted: tabs were numbered again
  assert.equal(review.tabOpen('s1'), null);
  assert.equal(review.report(sessions, form({tab: 3})).matched, 's1');
  assert.equal(review.tabOpen('s1'), true);
});

test('a form on another host than the posting still matches its session by the job the tab was opened for', () => {
  const sessions = [{id: 's1', url: 'https://www.jobs.ch/en/vacancies/detail/abc-def/', company: 'Undisclosed employer', startedAt: 1}];
  const form = {url: 'https://api.easytemp.ch/live/bew/15777849101268111120-FR.php#jobpilotto-fill', title: 'Software Developer (M/F)'};
  assert.equal(review.matchSession(sessions, form), null);                                             // by itself: nothing links them
  assert.equal(review.matchSession(sessions, {...form, job: 'https://www.jobs.ch/en/vacancies/detail/abc-def'})?.id, 's1');
  assert.equal(review.matchSession(sessions, {...form, job: 'https://www.jobs.ch/en/vacancies/detail/other'}), null);  // another job's tab
  review._reset();
  assert.notEqual(review.report(sessions, {...form, job: 'https://www.jobs.ch/en/vacancies/detail/abc-def/', left: 2, total: 5, watch: []}).matched, null);
});

test('an armed form on another site that names no company belongs to the one open session without a tab', () => {
  review._reset();
  const open = [{id: 'u1', url: 'https://www.jobs.ch/en/vacancies/detail/abc/', company: 'Undisclosed employer', status: 'input', live: true, startedAt: '2026-10-01T17:33:00Z'}];
  const agency = (extra = {}) => ({url: 'https://api.easytemp.ch/live/bew/1577784910-FR.php#jobpilotto-fill', title: 'Software Developer (M/F)', left: 3, total: 15, tab: 7, watch: [], ...extra});
  assert.equal(review.report(open, agency()).matched, 'u1');
  assert.equal(review.report(open, agency({url: 'https://api.easytemp.ch/other.php'})).matched, null);  // no fill mark: some stranger's tab
  review._reset();
  assert.equal(review.report(open, agency({url: 'https://job-boards.greenhouse.io/scaleai/jobs/4719479005#jobpilotto-fill', tab: 9})).matched, null);  // another job's form on a job board
  // Two sessions without a tab: ambiguous, no guess. One already on its own tab: the other is the one.
  review._reset();
  const two = [...open, {id: 'u2', url: 'https://boards.example/jobs/1', company: 'Example', status: 'running', live: true, startedAt: '2026-10-01T17:34:00Z'}];
  assert.equal(review.report(two, agency()).matched, null);
  review.report(two, {url: 'https://boards.example/jobs/1', title: 'Example', left: 1, total: 4, tab: 5, watch: []});
  assert.equal(review.report(two, agency({tab: 7})).matched, 'u1');
  review._reset();
});
