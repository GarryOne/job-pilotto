// Settings → Profile's tabs really render from each store's outline (tiny DOM, test/tiny-dom.js): this Mac's Markdown and Notion's blocks give the
// same tab, with no textarea and no ❓ on screen (owner, 16 Oct 2026), and an answer typed and saved is one block edit of that store's page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {outline} from '../lib/store/markdown-page.js';
import {install} from './tiny-dom.js';

const body = install();
const demo = file => fs.readFileSync(new URL(`../demo/${file}`, import.meta.url), 'utf8');
const row = (id, ...cells) => ({id, type: 'table_row', cells});
// Notion's shape of the owner's pages (16 Oct 2026 screenshots): a title heading, tables with a header row, plain bullets, an intro paragraph.
const NOTION = {
  answers: [{id: 'h0', type: 'heading_1', text: '📝 Application Answers — Standard Form Fields'}, {id: 'c0', type: 'callout', text: 'Fields marked ❓ are still open.'},
    {id: 'h1', type: 'heading_2', text: 'Eligibility'}, {id: 't1', type: 'table', header: true, rows: [row('r0', 'Question', 'Answer'),
      row('r1', 'Authorised to work in [your home country/region]?', '❓'), row('r2', 'Remote from your base for a foreign employer?', 'Yes')]},
    {id: 'h2', type: 'heading_2', text: 'Availability and pay'}, {id: 't2', type: 'table', header: true, rows: [row('r3', 'Question', 'Answer'),
      row('r4', 'Salary expectation — Switzerland', '❓ (salary is not a priority; estimated floor CHF 48,000 a year)'), row('r5', 'If a salary field is optional', 'Leave blank')]},
    {id: 'b1', type: 'bulleted_list_item', text: 'GitHub: ❓'}, {id: 'b2', type: 'bulleted_list_item', text: 'Website / portfolio: ❓ optional'}],
  knowledge: [{id: 'p0', type: 'paragraph', text: 'What Job Pilotto learned from your form fills, used by every later kit and fill.'},
    {id: 'k1', type: 'bulleted_list_item', text: '[jobs.example.test · answer] Name :: Field ID x asks for last name only. → "Doe"'},
    {id: 'k2', type: 'bulleted_list_item', text: '[any · option] Salutation: the form offers Mr / Ms'}],
};
NOTION.profile = [{id: 'p1', type: 'heading_1', text: 'Hard constraints'}, {id: 'p2', type: 'callout', text: 'Fields marked ❓ are still open.'},
  {id: 'p3', type: 'table', header: true, rows: [row('q0', 'Constraint', 'Value'), row('q1', 'Countries', 'Switzerland, Germany'), row('q2', 'Work mode', 'Hybrid or remote'),
    row('q3', 'Languages I can work in', 'English (fluent), German (B1)'), row('q4', 'Workload', '❓ full-time or a percentage'), row('q5', 'Minimum seniority', '❓')]},
  {id: 'p4', type: 'heading_1', text: 'Compensation'}, {id: 'p5', type: 'bulleted_list_item', text: 'Target: ❓'},
  {id: 'p6', type: 'heading_1', text: 'Summary (from CV)'}, {id: 'p7', type: 'paragraph', text: 'Engineer with 8 years of AWS.'}];
const LOCAL = {answers: outline(demo('answers.md')), knowledge: outline(demo('knowledge.md')), profile: outline(demo('profile.md'))};
// Every tab of Settings → Profile drawn from an outline: a new one is added here (the class, not the case).
const TABS = {answers: {load: 'loadApplicationAnswers', file: 'application-answers', body: 'answers-body'},
  preferences: {load: 'loadPreferences', file: 'job-preferences', body: 'preferences-body'},   // Strategy's Job preferences (was this page's tab)
  rest: {load: 'loadProfileRest', file: 'profile-rest', body: 'profile-rest-body'}};

for (const [store, items] of Object.entries({sqlite: LOCAL, notion: NOTION})) {
  test(`${store}: Application answers shows Needs review, the answers and the website rules, with no textarea and no ❓`, async () => {
    const sent = [];
    const calls = {textOutline: async name => ({ok: true, items: items[name], store, link: null}),
      textEdit: async (name, changes) => { sent.push([name, changes]); return {ok: true, items: items[name], store}; }};
    globalThis.window.pilot = new Proxy(calls, {get: (all, key) => all[key] || (() => null)});   // any other call: nothing
    const node = globalThis.document.createElement('div');
    node.id = 'answers-body';
    body.replaceChildren(node);
    const {loadApplicationAnswers} = await import('../renderer/pages/application-answers.js');
    await loadApplicationAnswers();
    const text = node.textContent;
    assert.equal(node.querySelectorAll('textarea').length, 0, 'no textarea');
    assert.ok(!text.includes('❓'), 'no ❓ on screen');
    assert.match(text, /Needs review/);
    assert.match(text, /Website-specific rules/);
    assert.match(text, /Not set/);
    // Every section but Needs review is collapsed with "N set · M missing"; an optional row is not missing and not in Needs review (owner, 17 Oct 2026).
    const cards = node.querySelectorAll('.qa-section').filter(card => !card.classList.contains('is-review') && !card.classList.contains('kn-rules'));
    assert.ok(cards.length, 'sections drawn');
    for (const card of cards) { assert.ok(!card.open, 'collapsed by default'); assert.match(card.textContent, /\d+ set · \d+ missing/); }
    assert.ok(!/portfolio/i.test(node.querySelector('.is-review').textContent), 'an optional row is not in Needs review');
    // Add answer on the first item that needs one, type, save: one block edit of the answers page.
    node.querySelector('.qa-add').click();
    const field = node.querySelector('.qa-edit input');
    field.value = 'Yes, EU citizen';
    field.dispatch('input');
    assert.equal(node.querySelector('.save-bar').hidden, false, 'the save bar shows a draft');
    await node.querySelector('#outline-save-answers').listeners.click[0]();
    assert.equal(sent.length, 1);
    const [[name, [change]]] = sent;
    assert.equal(name, 'answers');
    assert.ok(change.op === 'cell' ? change.value === 'Yes, EU citizen' && change.index === 1 : /Yes, EU citizen$/.test(change.value), JSON.stringify(change));
  });
}

for (const [store, items] of Object.entries({sqlite: LOCAL, notion: NOTION})) {
  for (const [name, {load, file, body: bodyId}] of Object.entries(TABS)) {
    test(`${store}: the ${name} tab has no textarea and no ❓ on screen`, async () => {
      const calls = {textOutline: async text => ({ok: true, items: items[text], store, link: null})};
      globalThis.window.pilot = new Proxy(calls, {get: (all, key) => all[key] || (() => null)});
      const node = globalThis.document.createElement('div');
      node.id = bodyId;
      body.replaceChildren(node);
      await (await import(`../renderer/pages/${file}.js`))[load]();
      assert.ok(node.textContent.length > 50, 'it drew something');
      assert.equal(node.querySelectorAll('textarea').length, 0);
      assert.ok(!node.textContent.includes('❓'), node.textContent.match(/.{0,40}❓.{0,40}/)?.[0]);
    });
  }
}

test('Job preferences: a country removed writes only its own cell, on the Notion shape', async () => {
  const sent = [];
  globalThis.window.pilot = new Proxy({textOutline: async () => ({ok: true, items: NOTION.profile, store: 'Notion'}),
    textEdit: async (name, changes) => { sent.push([name, changes]); return {ok: true, items: NOTION.profile}; }}, {get: (all, key) => all[key] || (() => null)});
  const node = globalThis.document.createElement('div');
  node.id = 'preferences-body';
  body.replaceChildren(node);
  await (await import('../renderer/pages/job-preferences.js')).loadPreferences();
  node.querySelectorAll('.chip .x').find(button => button.ariaLabel === 'Remove Germany').click();
  await node.querySelector('#outline-save-preferences').listeners.click[0]();
  assert.deepEqual(sent, [['profile', [{op: 'cell', id: 'q1', index: 1, value: 'Switzerland', was: 'Switzerland, Germany'}]]]);
});
