// Strategy → Your goals: a correction writes only the goal's own block in the Profile (a table row cell or a "Label: value" line), or adds it
// under "Confirmed during setup"; without Notion it goes into profile.md.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {findGoal, setGoal} from '../lib/goals.js';

const rich = text => [{plain_text: text}];
const row = (id, a, b) => ({id, type: 'table_row', table_row: {cells: [rich(a), rich(b)]}});
const tree = () => [
  {id: 'h', type: 'heading_2', heading_2: {rich_text: rich('Hard constraints')}},
  {id: 't', type: 'table', table: {}, children: [row('r1', 'Constraint', 'Value'), row('r2', '**Work mode**', 'On-site, hybrid or remote'),
    row('r3', 'Languages I can work in', 'French')]},
  {id: 'c', type: 'bulleted_list_item', bulleted_list_item: {rich_text: rich('**Minimum acceptable:** CHF 48,000 a year (estimate)')}},
];
function fake() {
  const calls = [];
  return {calls, lib: {pageTree: async () => tree(), setRowCell: async (token, block, index, text) => calls.push(['cell', block.id, index, text]),
    setBlockText: async (token, block, text) => calls.push(['text', block.id, text]), appendHeading: async () => { calls.push(['heading']); return 'new'; },
    insertBulletsAfter: async (token, page, after, lines) => calls.push(['bullets', after, lines])}};
}
const storage = (ids = {NOTION_PROFILE_PAGE_ID: 'p'}, files = {}) => ({secret: () => 'tok', settings: () => ({notionIds: ids}),
  readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; }, files});

test('each goal is found in its own block', () => {
  assert.equal(findGoal(tree(), 'work_mode').row.id, 'r2');
  assert.equal(findGoal(tree(), 'languages').row.id, 'r3');
  assert.equal(findGoal(tree(), 'minimum_salary').line.id, 'c');
  assert.equal(findGoal(tree(), 'seniority'), null);
});

test('a row goal sets its value cell, a line goal keeps its label, a missing one is added under its heading', async () => {
  const f = fake();
  await setGoal(storage(), 'work_mode', 'On-site only', {lib: f.lib});
  await setGoal(storage(), 'minimum_salary', 'CHF 50,000 a year', {lib: f.lib});
  await setGoal(storage(), 'seniority', 'Junior', {lib: f.lib});
  assert.deepEqual(f.calls.slice(0, 2), [['cell', 'r2', 1, 'On-site only'], ['text', 'c', 'Minimum acceptable: CHF 50,000 a year']]);
  assert.deepEqual(f.calls.slice(2), [['heading'], ['bullets', 'new', ['Minimum seniority: Junior']]]);
});

test('without Notion the Profile on this Mac is changed', async () => {
  const s = storage({}, {'profile.md': '| Work mode | On-site, hybrid or remote |\n'});
  assert.equal((await setGoal(s, 'work_mode', 'On-site only', {lib: fake().lib})).where, 'local');
  assert.match(s.files['profile.md'], /\| Work mode \| On-site only \|/);
});

test('only the four goals, never an empty value', async () => {
  await assert.rejects(setGoal(storage(), 'title', 'x', {lib: fake().lib}), /Not a goal/);
  await assert.rejects(setGoal(storage(), 'work_mode', '  ', {lib: fake().lib}), /Write a value/);
});
