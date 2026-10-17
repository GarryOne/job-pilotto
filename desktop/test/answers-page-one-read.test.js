// A cold start reads the answers page once, not once per screen: Application questions (list), Application answers (standardAnswers), the store's blocks/outline/text
// all share the kept page tree. Before 17 Oct 2026 outline() read the whole page fresh each time (the review drawer took ~10 s to open after a restart).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as notion from '../lib/notion.js';
import * as questions from '../lib/questions.js';
import {openStore} from '../lib/store/index.js';
import {createStorage} from '../lib/storage.js';

const rt = text => [{plain_text: text, text: {content: text}, annotations: {bold: false}}];
const top = [{id: 'line', type: 'bulleted_list_item', bulleted_list_item: {rich_text: rt('Visa needed: ❓ (asked by Acme)')}, has_children: false},
  {id: 'table', type: 'table', table: {has_column_header: true}, has_children: true}];
const cells = [['Question', 'Answer'], ['Notice period', '3 months'], ['Salary', '❓ to confirm']].map((r, i) => ({id: `row${i}`, type: 'table_row', table_row: {cells: r.map(rt)}}));

function realFetchStub() {
  const routes = [];
  globalThis.fetch = async (url, init = {}) => {
    const route = url.replace('https://api.notion.com/v1/', '').split('?')[0];
    routes.push(`${init.method || 'GET'} ${route}`);
    const reply = data => ({ok: true, json: async () => data});
    if (route === 'pages/answers') return reply({last_edited_time: new Date(Date.now() - 3_600_000).toISOString()});
    if (route === 'blocks/answers/children') return reply({results: top.map(b => ({...b})), has_more: false});
    if (route === 'blocks/table/children') return reply({results: cells.map(c => ({...c})), has_more: false});
    return reply({results: [], has_more: false});
  };
  return routes;
}
function storage() {
  const s = createStorage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-')), 'x'), {encrypt: v => v, decrypt: v => v});
  s.setSecret('NOTION_TOKEN', 'ntn');
  s.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}, telemetry: false});
  return s;
}
const screens = {
  'Application questions (list)': s => questions.list(s),
  'Application answers (standardAnswers)': s => questions.standardAnswers(s),
  'the store outline': s => openStore(s).page('answers').outline(),
  'the store blocks': s => openStore(s).page('answers').blocks(),
  'the store text': s => openStore(s).page('answers').text(),
};

test('every screen that reads the answers page, all at once on a cold start: one read of the page', async () => {
  const real = globalThis.fetch;
  notion.useSleep(async () => {});
  try {
    notion._trees.reset();
    const routes = realFetchStub();
    const s = storage();
    await Promise.all(Object.values(screens).map(read => read(s)));
    const children = routes.filter(r => /^GET blocks\//.test(r));
    assert.deepEqual(children.sort(), ['GET blocks/answers/children', 'GET blocks/table/children'], `one tree read, got ${routes.join(', ')}`);
  } finally { globalThis.fetch = real; notion.useSleep(ms => new Promise(r => setTimeout(r, ms))); notion._trees.reset(); }
});

for (const [name, read] of Object.entries(screens)) {
  test(`${name}: a second open right after the first costs no page read`, async () => {
    const real = globalThis.fetch;
    notion.useSleep(async () => {});
    try {
      notion._trees.reset();
      const routes = realFetchStub();
      const s = storage();
      await read(s);
      const first = routes.length;
      await read(s);
      assert.equal(routes.length, first, 'the kept page answers the second open');
    } finally { globalThis.fetch = real; notion.useSleep(ms => new Promise(r => setTimeout(r, ms))); notion._trees.reset(); }
  });
}
