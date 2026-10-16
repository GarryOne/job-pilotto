// Settings → Profile's texts edited block by block on every store (lib/text-outline-handlers.js): a cell, a line, a removal, an insert after a table and
// an append land where they should; a block that changed since it was read is left alone and named.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import {applyEdits, registerTextOutlineHandlers} from '../lib/text-outline-handlers.js';
import {fakeNotion} from './fake-notion.js';

const plainCrypto = {encrypt: value => value, decrypt: value => value};
function storageWith(settings, secrets = {}) {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-outline-')), plainCrypto);
  storage.saveSettings(settings);
  for (const [name, value] of Object.entries(secrets)) storage.setSecret(name, value);
  return storage;
}
const ANSWERS = '## Eligibility\n\n| Question | Answer |\n|---|---|\n| Notice period | ❓ to confirm |\n| Salary | 100k |\n\n- **Visa:** EU citizen\n- Old line\n\n## Links\n- GitHub: ❓\n';

test('this Mac: cell, line, removal, insert after a table and append, in one save; the rest of the text unchanged', async () => {
  const storage = storageWith({store: 'sqlite'});
  const page = store.openStore(storage).page('answers');
  await page.write(ANSWERS);
  const items = await page.outline();
  const table = items.find(item => item.type === 'table'), visa = items.find(item => item.text?.startsWith('**Visa')), old = items.find(item => item.text === 'Old line');
  const {saved, missing} = await applyEdits(page, items, [
    {op: 'cell', id: table.rows[1].id, index: 1, value: '3 months', was: '❓ to confirm'},
    {op: 'text', id: visa.id, value: '**Visa:** EU and Swiss', was: visa.text},
    {op: 'remove', id: old.id, was: 'Old line'},
    {op: 'insert', after: table.id, lines: ['Relocation: yes']},
    {op: 'append', lines: ['Portfolio: none']},
  ]);
  assert.deepEqual([saved, missing], [5, []]);
  assert.equal(storage.readText('answers.md'), '## Eligibility\n\n| Question | Answer |\n|---|---|\n| Notice period | 3 months |\n| Salary | 100k |\n- Relocation: yes\n\n- **Visa:** EU and Swiss\n\n## Links\n- GitHub: ❓\n- Portfolio: none\n');
});

test('a block that changed since it was read is not written, and is named', async () => {
  const storage = storageWith({store: 'sqlite'});
  const page = store.openStore(storage).page('answers');
  await page.write(ANSWERS);
  const items = await page.outline();
  const table = items.find(item => item.type === 'table');
  const {saved, missing} = await applyEdits(page, items, [{op: 'cell', id: table.rows[2].id, index: 1, value: 'x', was: '90k'}, {op: 'text', id: 'L99', value: 'x'}]);
  assert.deepEqual([saved, missing], [0, [table.rows[2].id, 'L99']]);
  assert.equal(storage.readText('answers.md'), ANSWERS);
});

test('Notion: the same changes go to the page block by block (no whole-page write)', async () => {
  const notion = fakeNotion();
  const storage = storageWith({store: 'notion', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}}, {NOTION_TOKEN: 'secret'});
  const page = store.openStore(storage, {fetcher: notion.fetcher}).page('answers');
  await page.append(['Visa: EU citizen', 'Old line', 'GitHub: ❓']);
  const items = await page.outline();
  const {saved, missing} = await applyEdits(page, items, [
    {op: 'text', id: items[0].id, value: 'Visa: EU and Swiss', was: 'Visa: EU citizen'},
    {op: 'remove', id: items[1].id, was: 'Old line'},
    {op: 'insert', after: items[0].id, lines: ['Relocation: yes']},
    {op: 'append', lines: ['Portfolio: none']},
  ]);
  assert.deepEqual([saved, missing], [4, []]);
  assert.deepEqual((await page.outline()).map(item => item.text), ['Visa: EU and Swiss', 'Relocation: yes', 'GitHub: ❓', 'Portfolio: none']);
});

test('the IPC reads and edits any of the three texts, refuses another name, and logs counts, never words', async () => {
  const handlers = {}, logged = [];
  const storage = storageWith({store: 'sqlite'});
  registerTextOutlineHandlers({ipcMain: {handle: (name, fn) => { handlers[name] = fn; }}, storage, DEMO: false, log: (...args) => logged.push(args)});
  for (const name of store.TEXTS) {
    await store.openStore(storage).page(name).write('- a: ❓\n');
    const read = await handlers.textOutline(null, name);
    assert.equal(read.ok, true, name);
    const edited = await handlers.textEdit(null, name, [{op: 'text', id: read.items[0].id, value: 'a: b', was: 'a: ❓'}]);
    assert.deepEqual(edited.items.map(item => item.text), ['a: b'], name);
  }
  assert.equal((await handlers.textOutline(null, 'secrets')).ok, false);
  assert.ok(!JSON.stringify(logged).includes('a: b'));
});

// The store contract for the Profile tabs (cc review of #971): the same block edits on this Mac and on Notion (the fake, tables included) change
// only their own block; every other block reads back exactly as before.
const PAGE = ['## Eligibility', {table: [['Question', 'Answer'], ['Notice period', '❓ to confirm'], ['Salary', '100k']]}, 'Visa: EU citizen', 'Old line', '## Links', 'GitHub: ❓'];
const MARKDOWN = '## Eligibility\n\n| Question | Answer |\n|---|---|\n| Notice period | ❓ to confirm |\n| Salary | 100k |\n\n- Visa: EU citizen\n- Old line\n\n## Links\n- GitHub: ❓\n';
const STORES = {
  sqlite: async () => { const page = store.openStore(storageWith({store: 'sqlite'})).page('answers'); await page.write(MARKDOWN); return page; },
  notion: async () => {
    const notion = fakeNotion(PAGE);
    const storage = storageWith({store: 'notion', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}}, {NOTION_TOKEN: 'secret'});
    return store.openStore(storage, {fetcher: notion.fetcher}).page('answers');
  },
};
const shape = items => items.map(item => (item.type === 'table' ? {table: item.rows.map(row => row.cells)} : {[item.type]: item.text}));

for (const [name, open] of Object.entries(STORES)) {
  test(`${name}: a cell, a line, a removal, an insert after a table and an append each change only their block`, async () => {
    const page = await open();
    const items = await page.outline();
    const before = shape(items);
    const table = items.find(item => item.type === 'table');
    const visa = items.find(item => item.text === 'Visa: EU citizen'), old = items.find(item => item.text === 'Old line');
    const {saved, missing} = await applyEdits(page, items, [
      {op: 'cell', id: table.rows[1].id, index: 1, value: '3 months', was: '❓ to confirm'},
      {op: 'text', id: visa.id, value: 'Visa: EU and Swiss', was: 'Visa: EU citizen'},
      {op: 'remove', id: old.id, was: 'Old line'},
      {op: 'insert', after: table.id, lines: ['Relocation: yes']},
      {op: 'append', lines: ['Portfolio: none']},
    ]);
    assert.deepEqual([saved, missing], [5, []]);
    const expected = before.flatMap(block => {
      if (block.table) return [{table: block.table.map(cells => (cells[0] === 'Notice period' ? ['Notice period', '3 months'] : cells))}, {bulleted_list_item: 'Relocation: yes'}];
      if (block.bulleted_list_item === 'Visa: EU citizen') return [{bulleted_list_item: 'Visa: EU and Swiss'}];
      if (block.bulleted_list_item === 'Old line') return [];
      return [block];
    });
    expected.push({bulleted_list_item: 'Portfolio: none'});
    assert.deepEqual(shape(await page.outline()), expected);
  });
}
