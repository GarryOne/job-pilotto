// Application questions (owner's mockup, 17 Oct 2026: "THIS IS TOO CROWDED/OVERWHELMING... Move the questionnaire out of the Jobs page"): Jobs shows
// one compact card whose count is the review queue (never the set-aside ones), and the questions are answered one at a time in a drawer
// (pages/question-review.js) that shares the job drawer's overlay slot. Every way in (Jobs' card, Profile → Application answers, ⌘K) opens it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const LIST = [
  {key: 'start', question: 'What is your earliest start date, and are there any constraints we should be aware of?', company: 'DeepJudge AG', proposal: '1 December 2026', coveredBy: 'Notice period / earliest start', format: {kind: 'text', control: 'text', options: []}},
  {key: 'salary', question: 'What is your salary expectation? (In USD monthly)', company: 'Colonist', format: {kind: 'text', control: 'text', options: []}},
  {key: 'permit', question: 'Do you have a valid permission to work in Switzerland?', company: 'DeepJudge AG', format: {kind: 'yes_no', control: 'yes_no', options: ['Yes', 'No']}},
];
const HIDDEN = [{key: 'title', question: 'Title', company: 'Adnovum', format: {kind: 'single', control: 'single', options: ['Mr', 'Ms']}}];
const calls = [];
const ids = ['questions', 'questions-count', 'questions-error', 'questions-retry', 'questions-review', 'questions-manage', 'review-drawer-layer', 'review-drawer-backdrop', 'review-panel'];
for (const id of ids) { const node = globalThis.document.createElement('div'); node.id = id; body.append(node); }
globalThis.window.pilot = new Proxy({
  openQuestions: async () => ({list: LIST.map(q => ({...q})), hidden: HIDDEN, consent: 2}),
  answerQuestion: async (key, value) => { calls.push([key, value]); return {ok: true, homeName: key === 'start' ? 'Your details → 💶 Availability & compensation' : ''}; },
}, {get: (all, key) => all[key] || (() => null)});
const {loadQuestions} = await import('../renderer/pages/jobs-questions.js');
const review = await import('../renderer/pages/question-review.js');
const slot = await import('../renderer/overlay-slot.js');
const $ = id => globalThis.document.getElementById(id);
const panel = () => $('review-panel');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('Jobs: one compact card, its count is the review queue (3), not the queue plus the set-aside one; no inputs, no Notion, no "every application"', async () => {
  await loadQuestions({force: true});
  assert.equal($('questions').hidden, false);
  assert.equal($('questions-count').textContent, '3 need review');
  assert.equal($('questions').querySelectorAll('input').length + $('questions').querySelectorAll('select').length, 0);
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const card = html.slice(html.indexOf('id="questions"'), html.indexOf('</section>', html.indexOf('id="questions"')));
  assert.match(card, /Application questions/);
  assert.match(card, /Review missing answers and suggested matches\./);
  assert.match(card, /Review questions/);
  assert.match(card, /Manage saved answers/);
  assert.doesNotMatch(card, /Notion|every application|Answer once/);
});

test('the drawer: Question 1 of 3, a selector with the set-aside one listed apart, a suggested answer told apart from a missing one', async () => {
  await review.openQuestionReview();
  assert.equal($('review-drawer-layer').hidden, false);
  assert.match(panel().textContent, /Question 1 of 3/);
  const pick = panel().querySelector('#qr-pick');
  assert.deepEqual(pick.querySelectorAll('option').map(option => option.value), ['q:0', 'q:1', 'q:2', 's:0']);
  assert.match(pick.querySelector('optgroup').label, /Set aside \(1\)/);
  assert.ok(panel().querySelector('.qr-answer.is-suggested'), 'a proposal is a suggestion');
  assert.match(panel().textContent, /Suggested from saved answer/);
  assert.match(panel().querySelector('.qr-source').textContent, /Notice period \/ earliest start/);
  assert.match(panel().textContent, /DeepJudge AG · Application form/);
  for (const id of ['qr-back', 'qr-skip', 'qr-confirm']) assert.ok(panel().querySelector(`.qr-foot #${id}`), id);
  panel().querySelector('#qr-skip').click();
  assert.match(panel().textContent, /Question 2 of 3/);
  assert.ok(panel().querySelector('.qr-answer.is-missing'), 'no answer yet: missing');
  assert.equal(panel().querySelector('#qr-confirm').disabled, true, 'Confirm waits for an answer (UI loop #64)');
  panel().querySelector('#qr-back').click();
  assert.match(panel().textContent, /Question 1 of 3/);
});

test('a draft is kept when the drawer closes; Confirm & next saves, says where, and the queue shrinks; Don’t keep saves an empty answer', async () => {
  calls.length = 0;
  await review.openQuestionReview();
  panel().querySelector('#qr-skip').click();   // the salary question
  const field = panel().querySelector('#qr-control');
  field.value = '9000';
  field.dispatch('input');
  assert.equal(panel().querySelector('#qr-confirm').disabled, false);
  review.closeQuestionReview();
  assert.equal($('review-drawer-layer').hidden, true);
  await review.openQuestionReview({start: 'salary'});
  assert.equal(panel().querySelector('#qr-control').value, '9000', 'the draft came back');
  panel().querySelector('#qr-confirm').click();
  await flush();
  assert.deepEqual(calls, [['salary', '9000']]);
  assert.match(panel().textContent, /Question 2 of 2/);
  assert.match(panel().textContent, /✓ Saved to your application answers/);
  panel().querySelector('#qr-back').click();
  panel().querySelector('#qr-confirm').click();   // accept the suggested start date
  await flush();
  assert.deepEqual(calls[1], ['start', '1 December 2026']);
  assert.match(panel().textContent, /Saved to Your details → 💶 Availability & compensation/);
  panel().querySelector('#qr-drop').click();
  await flush();
  assert.deepEqual(calls[2], ['permit', '']);
  assert.match(panel().textContent, /All questions reviewed/);
});

test('it shares the job drawer\'s overlay slot: opening it closes a job or Recent activity, never stacks', async () => {
  let closed = 0;
  slot.registerOverlay('job', {close: () => { closed++; }, open() {}});
  slot.claimOverlay('job');
  await review.openQuestionReview();
  assert.equal(closed, 1);
  review.closeQuestionReview();
});

test('every way in opens the same drawer: Jobs\' card, Profile → Application answers, ⌘K', () => {
  const read = file => fs.readFileSync(new URL(`../renderer/pages/${file}`, import.meta.url), 'utf8');
  assert.match(read('question-review.js'), /\$\('questions-review'\)\?\.addEventListener\('click', \(\) => openQuestionReview\(\)\)/);
  assert.match(read('application-answers.js'), /answers-review-go[\s\S]{0,400}openQuestionReview\(\)/);
  assert.match(read('nav.js'), /'Review application questions'[\s\S]{0,300}openQuestionReview\(\)/);
});
