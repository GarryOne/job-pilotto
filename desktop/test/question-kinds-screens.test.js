// The owner's five live examples (17 Oct 2026: "pay attention to the field/question format") drawn on EVERY screen that lists open questions: each gets the
// control of its kind, never a text box for a choice. A new screen that lists them is added to SCREENS (the class, not the case).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
import {formatFor, markOf} from '../renderer/question-kind.js';

const body = install();
const EXAMPLES = [
  {question: 'Yes, I live in Switzerland, or am willing to relocate if I currently live elsewhere', mark: {kind: 'yes_no', options: []}, want: 'yes_no'},
  {question: 'Do you have a valid permission to work in Switzerland?', mark: {kind: 'single', options: ['Yes', 'No']}, want: 'single'},
  {question: 'To be eligible to work in Switzerland, please select what applies', mark: {kind: 'single', options: ['Swiss citizen', 'EU/EFTA citizen', 'C permit', 'B permit', 'None of these']}, want: 'single'},
  {question: 'Title', mark: {kind: 'single', options: ['Mr', 'Mrs', 'Ms']}, want: 'single'},
  {question: 'Country/Region of Residence', mark: {kind: 'single', options: [], list: 'countries'}, want: 'single'},
  {question: 'Notice period', mark: null, want: 'text'},
];
const kindsIn = node => node.querySelectorAll('[data-answer-kind]').map(control => control.dataset.answerKind);
const isChoice = control => control.tagName === 'SELECT' || control.className.includes('segmented');

const SCREENS = {
  'Jobs → Answer once': async () => {
    for (const id of ['questions', 'questions-count', 'questions-list', 'questions-error', 'questions-retry']) {
      const node = globalThis.document.createElement(id === 'questions' ? 'details' : 'div');
      node.id = id;
      body.append(node);
    }
    const calls = {state: async () => ({settings: {}}), openQuestions: async () => ({list: EXAMPLES.map((each, i) => ({key: `b${i}`, question: each.question, company: 'Adnovum', format: formatFor({marked: each.mark})})), hidden: []})};
    globalThis.window.pilot = new Proxy(calls, {get: (all, key) => all[key] || (() => null)});
    const {loadQuestions} = await import('../renderer/pages/jobs-questions.js');
    await loadQuestions({force: true});
    return globalThis.document.getElementById('questions-list');
  },
  'Profile → Application answers → Needs review': async () => {
    const node = globalThis.document.createElement('div');
    node.id = 'answers-body';
    body.append(node);
    const lines = EXAMPLES.map((each, i) => ({id: `l${i}`, type: 'bulleted_list_item', text: `${each.question}: ❓ (asked by Adnovum)${each.mark ? ` ${markOf(each.mark)}` : ''}`}));
    globalThis.window.pilot = new Proxy({textOutline: async name => ({ok: true, items: name === 'answers' ? [{id: 'h', type: 'heading_2', text: 'Asked on forms'}, ...lines] : [], store: 'sqlite', link: null}),
      questionVerdicts: async labels => ({ok: true, verdicts: Object.fromEntries(labels.map(label => [label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(), {reuse: 'reusable', covered_by: ''}])), formats: {}})},
    {get: (all, key) => all[key] || (() => null)});
    const {loadApplicationAnswers} = await import('../renderer/pages/application-answers.js');
    await loadApplicationAnswers();
    await new Promise(resolve => setTimeout(resolve, 10));   // the verdicts arrive and the tab redraws
    // Open every Needs review row: its answer control is drawn open.
    for (const button of node.querySelectorAll('.is-review .qa-add')) button.listeners.click?.forEach(fn => fn({}));
    return node.querySelector('.is-review');
  },
};

for (const [name, draw] of Object.entries(SCREENS)) {
  test(`${name}: each of the five examples gets the control of its kind`, async () => {
    const node = await draw();
    assert.ok(node, 'the screen drew its list');
    const kinds = kindsIn(node);
    assert.deepEqual([...kinds].sort(), EXAMPLES.map(each => each.want).sort(), kinds.join(', '));
    const controls = node.querySelectorAll('[data-answer-kind]');
    for (const control of controls.filter(each => each.dataset.answerKind !== 'text')) assert.ok(isChoice(control), `${control.dataset.answerKind} is a choice, not a text box`);
  });
}
