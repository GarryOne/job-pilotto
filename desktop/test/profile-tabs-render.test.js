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
    {id: 'b1', type: 'bulleted_list_item', text: 'GitHub: ❓'}],
  knowledge: [{id: 'p0', type: 'paragraph', text: 'What Job Pilotto learned from your form fills, used by every later kit and fill.'},
    {id: 'k1', type: 'bulleted_list_item', text: '[jobs.example.test · answer] Name :: Field ID x asks for last name only. → "Doe"'},
    {id: 'k2', type: 'bulleted_list_item', text: '[any · option] Salutation: the form offers Mr / Ms'}],
};
const LOCAL = {answers: outline(demo('answers.md')), knowledge: outline(demo('knowledge.md'))};

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
