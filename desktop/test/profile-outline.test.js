// The Profile form on Notion (lib/profile-outline.js, lib/profile-form-handlers.js): the page's outline becomes the form's sections with the id of
// every row and bullet; saving changes exactly one cell or one bullet through the store, only inside the known sections, and nothing else.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applyChanges, editable, fromOutline} from '../lib/profile-outline.js';
import {registerProfileFormHandlers} from '../lib/profile-form-handlers.js';
import {LINKS} from '../lib/store/index.js';

const row = (id, ...cells) => ({id, type: 'table_row', cells, raw: {id, table_row: {cells: []}}});
const OUTLINE = () => [
  {id: 'callout', type: 'callout', text: 'The AI scorer reads this page at every run.'},
  {id: 'h1', type: 'heading_1', text: 'Hard constraints'},
  {id: 'p1', type: 'paragraph', text: 'Jobs that break these are filtered out.'},
  {id: 't1', type: 'table', header: true, rows: [row('r0', 'Constraint', 'Value'), row('r1', 'Countries', 'Switzerland'), row('r2', 'Home base', 'Geneva; ❓ relocate')]},
  {id: 'h2', type: 'heading_1', text: 'Compensation'},
  {id: 'b1', type: 'bulleted_list_item', text: 'Target: CHF 150k'},
  {id: 'b2', type: 'bulleted_list_item', text: 'Minimum acceptable: ❓'},
  {id: 'h3', type: 'heading_1', text: 'Summary (from CV)'},
  {id: 'p2', type: 'paragraph', text: 'Platform engineer.'},
  {id: 't2', type: 'table', header: true, rows: [row('x0', 'School', 'Degree'), row('x1', 'ETH', 'MSc')]},
];

test('the outline becomes the form: rows and bullets with their ids, notes and the rest as read-only text', () => {
  const model = fromOutline(OUTLINE());
  assert.deepEqual(model.sections.map(s => [s.kind, s.heading]), [['constraints', 'Hard constraints'], ['pay', 'Compensation']]);
  assert.deepEqual(model.sections[0].rows, [{id: 'r1', cells: ['Countries', 'Switzerland']}, {id: 'r2', cells: ['Home base', 'Geneva; ❓ relocate']}]);
  assert.deepEqual(model.sections[0].header, ['Constraint', 'Value']);
  assert.equal(model.sections[0].notes, 'Jobs that break these are filtered out.');
  assert.deepEqual(model.sections[1].bullets, [{id: 'b1', label: 'Target', value: 'CHF 150k'}, {id: 'b2', label: 'Minimum acceptable', value: '❓'}]);
  assert.match(model.rest, /The AI scorer reads this page/);
  assert.match(model.rest, /Platform engineer\./);
  assert.match(model.rest, /ETH \| MSc/, 'a table outside the known sections stays in the rest, read-only');
});

test('a change touches one cell or one bullet, only inside the known sections', async () => {
  const calls = [];
  const page = {setCell: async (rowItem, index, value) => calls.push(['cell', rowItem.id, index, value]), setText: async (block, text) => calls.push(['text', block.id, block.type, text])};
  const {saved, missing} = await applyChanges(page, OUTLINE(), [
    {id: 'r1', kind: 'cell', value: 'Switzerland and\nEU'}, {id: 'b1', kind: 'bullet', value: 'CHF 160k'},
    {id: 'x1', kind: 'cell', value: 'hacked'},       // a table in the Summary section: not reachable
    {id: 'p2', kind: 'bullet', value: 'hacked'},       // a paragraph: not reachable
    {id: 'gone', kind: 'cell', value: 'x'}]);
  assert.deepEqual(calls, [['cell', 'r1', 1, 'Switzerland and EU'], ['text', 'b1', 'bulleted_list_item', 'Target: CHF 160k']]);
  assert.equal(saved, 2);
  assert.deepEqual(missing, ['x1', 'p2', 'gone']);
  assert.deepEqual([...editable(OUTLINE()).rows.keys()], ['r1', 'r2']);
});

test('the IPC reads and saves through the store only when its page is the editor (Notion)', async () => {
  const handlers = {};
  const ipcMain = {handle: (name, fn) => { handlers[name] = fn; }};
  const writes = [];
  const page = {outline: async () => OUTLINE(), setCell: async (r, i, v) => writes.push([r.id, i, v]), setText: async () => {}};
  const logged = [];
  const notion = () => ({caps: new Set([LINKS]), page: () => page});
  registerProfileFormHandlers({ipcMain, storage: {}, DEMO: false, log: (...a) => logged.push(a), open: notion});
  const form = await handlers.profileForm();
  assert.equal(form.ok, true);
  assert.equal(form.sections.length, 2);
  const answer = await handlers.profileFormSave({}, [{id: 'r2', kind: 'cell', value: 'Geneva, ready to relocate'}]);
  assert.equal(answer.ok, true);
  assert.deepEqual(writes, [['r2', 1, 'Geneva, ready to relocate']]);
  assert.ok(logged.every(([, , fields]) => !JSON.stringify(fields || {}).includes('Geneva')), 'the log says how many, never what');
  assert.equal((await handlers.profileFormSave({}, [])).ok, false);
  assert.equal((await handlers.profileFormSave({}, [{id: 'nope', kind: 'cell', value: 'x'}])).ok, false, 'a vanished row is reported, never skipped silently');
  // This Mac's store: the form uses the local text instead.
  const local = {};
  registerProfileFormHandlers({ipcMain: {handle: (n, f) => { local[n] = f; }}, storage: {}, DEMO: false, log() {}, open: () => ({caps: new Set(), page: () => page})});
  assert.deepEqual(await local.profileForm(), {ok: false});
  assert.equal((await local.profileFormSave({}, [{id: 'r1', kind: 'cell', value: 'x'}])).ok, false);
});

test('demo mode answers with a made-up page and never writes', async () => {
  const demo = {};
  registerProfileFormHandlers({ipcMain: {handle: (n, f) => { demo[n] = f; }}, storage: {}, DEMO: true, log() {}, open: () => { throw new Error('the demo must not open a store'); }});
  const form = await demo.profileForm();
  assert.equal(form.ok, true);
  assert.deepEqual(form.sections.map(s => s.kind), ['constraints', 'pay']);
  assert.equal((await demo.profileFormSave({}, [{id: 'r1', kind: 'cell', value: 'x'}])).ok, false);
});
