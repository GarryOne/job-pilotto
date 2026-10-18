// Profile → Application answers → "Profile facts used in forms" (owner, 18 Oct 2026, decision 1): the Your details facts a form asked for, read from
// Your details (one copy), drawn as read-only rows with one reference link to Your details; nothing here is editable (lib/form-facts.js, pages/answers-facts.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {usedInForms} from '../lib/form-facts.js';
import {install} from './tiny-dom.js';

const FACTS = [{label: 'Location', value: 'London'}, {label: 'Notice period', value: '1 month'}, {label: 'GitHub', value: 'github.com/alex-demo'},
  {label: 'Salutation', value: ''}, {label: 'Phone', value: '+44 20 7946 0000'}];
const VERDICTS = {
  a: {reuse: 'details', fact: 'Notice period', asked: 3},
  b: {reuse: 'details', fact: 'Location', asked: 1, blocked: true},
  c: {reuse: 'details', fact: 'Location', asked: 2},
  d: {reuse: 'details', fact: 'Salutation', asked: 4},     // asked, but Your details has no value: the review queue asks it, not this card
  e: {reuse: 'details', fact: 'Phone'},                    // mapped, never asked by a form
  f: {reuse: 'reusable', fact: '', asked: 9},
  g: {reuse: 'details', fact: 'Invented fact', asked: 2},  // a label Your details does not have
};

test('only facts a form asked for and Your details holds, most asked first, with its value from Your details', () => {
  assert.deepEqual(usedInForms(VERDICTS, FACTS), [{label: 'Location', value: 'London', asked: 3}, {label: 'Notice period', value: '1 month', asked: 3}].sort((a, b) => b.asked - a.asked));
  assert.deepEqual(usedInForms({}, FACTS), []);
  assert.deepEqual(usedInForms(null, null), []);
});

test('the card: label | value rows, one header link opens Your details; nothing to edit here; an empty line when no form asked yet', async () => {
  const body = install();
  const tabs = globalThis.document.createElement('button');
  tabs.dataset.profileTab = 'details';
  let opened = 0;
  tabs.addEventListener('click', () => { opened += 1; });
  const node = globalThis.document.createElement('div'), link = globalThis.document.createElement('button');
  node.id = 'answers-facts-body';
  link.id = 'answers-facts-open';
  body.append(tabs, link, node);
  globalThis.window.pilot = {formFacts: async () => ({ok: true, facts: usedInForms(VERDICTS, FACTS)})};
  const {loadAnswersFacts} = await import('../renderer/pages/answers-facts.js');
  await loadAnswersFacts();
  assert.deepEqual(node.querySelectorAll('dt').map(term => term.textContent), ['Location', 'Notice period']);
  assert.deepEqual(node.querySelectorAll('dd').map(value => value.textContent), ['London', '1 month']);
  assert.equal(node.querySelectorAll('.reference-row').length, 0, 'no line under the table (mockup 02): the link is in the header');
  assert.ok(!node.querySelector('input, textarea, select'), 'read-only');
  await loadAnswersFacts();
  assert.equal(link.listeners.click.length, 1, 'wired once, however often the card loads');
  link.listeners.click[0]();
  assert.equal(opened, 1, 'the header link opens the Your details tab');
  globalThis.window.pilot = {formFacts: async () => ({ok: true, facts: []})};
  await loadAnswersFacts();
  assert.match(node.textContent, /No form has asked for a fact of Your details yet/);
});

test('the panel sits first on Application answers and says where the facts are changed', () => {
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const facts = html.indexOf('id="setting-answers-facts"'), answers = html.indexOf('id="setting-answers"');
  assert.ok(facts > 0 && facts < answers, 'before the answers');
  assert.match(html.slice(facts, answers), /data-profile-panel="answers"[\s\S]*Profile facts used in forms[\s\S]*id="answers-facts-body"/);
});
