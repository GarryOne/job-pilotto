import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as notion from '../lib/notion.js';

const T = notion.TEMPLATE;
const title = text => [{plain_text: text}];

// A fake Notion API holding a user's copy of the template (plus an old duplicate and a stray page).
function fakeNotion({dropDatabase = null, dropColumn = null} = {}) {
  const calls = [];
  const databases = Object.entries(T.databases).filter(([env]) => env !== dropDatabase)
    .map(([env, name], i) => ({object: 'database', id: `db_${env}`, title: title(`💠 ${name}`), last_edited_time: `2026-09-2${i % 9}`}));
  for (const item of databases) item.parent = {page_id: 'workspace-copy'};
  // An older, partial duplicate elsewhere: must not be mixed in.
  databases.push({object: 'database', id: 'oldapplications', parent: {page_id: 'old-copy'}, title: title(T.databases.NOTION_APPLICATIONS_DB), last_edited_time: '2030-01-01'});
  const pages = Object.entries(T.pages).map(([env, name]) => ({object: 'page', id: `page_${env}`, parent: {page_id: 'workspace-copy'}, last_edited_time: '2026-09-27',
    properties: {title: {type: 'title', title: title(name)}}}));
  pages.push({object: 'page', id: 'stray', last_edited_time: '2026-09-27', properties: {title: {type: 'title', title: title('Groceries')}}});
  const fetcher = async (url, init = {}) => {
    const route = url.replace('https://api.notion.com/v1/', '');
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({method: init.method, route, body});
    const reply = data => new Response(JSON.stringify(data), {status: 200});
    if (route === 'users/me') return reply({object: 'user'});
    if (route === 'search') return reply({results: body.filter.value === 'database' ? databases : pages, has_more: false});
    const db = /^databases\/db_(\w+)$/.exec(route);
    if (db) {
      const names = T.required_properties[db[1]].filter(name => !(db[1] === 'NOTION_APPLICATIONS_DB' && name === dropColumn));
      return reply({properties: Object.fromEntries(names.map(name => [name, {}]))});
    }
    if (route.startsWith('blocks/') && init.method === 'GET') return reply({results: [{id: 'b1'}, {id: 'b2'}], has_more: false});
    return reply({});
  };
  return {calls, fetcher};
}

test('titles match without emoji, punctuation or case', () => {
  assert.equal(notion.normalise('💠 Applications — Job Tracker'), notion.normalise('Applications — Job Tracker'));
  assert.notEqual(notion.normalise('Applications'), notion.normalise('Applications — Job Tracker'));
});

test('connect finds every database and page, newest copy first, and checks columns', async () => {
  const {fetcher} = fakeNotion();
  const result = await notion.connect('ntn_x', fetcher);
  assert.equal(result.ok, true);
  assert.equal(result.ids.NOTION_APPLICATIONS_DB, 'db_NOTION_APPLICATIONS_DB'); // not the newer stray copy
  assert.equal(result.ids.NOTION_PROFILE_PAGE_ID, 'page_NOTION_PROFILE_PAGE_ID');
  assert.equal(Object.keys(result.ids).length, Object.keys(T.databases).length + Object.keys(T.pages).length);
});

test('a database not shared with the connection is reported by title', async () => {
  const {fetcher} = fakeNotion({dropDatabase: 'NOTION_INSIGHTS_DB'});
  const result = await notion.connect('ntn_x', fetcher);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, [T.databases.NOTION_INSIGHTS_DB]);
});

test('a renamed column is reported', async () => {
  const {fetcher} = fakeNotion({dropColumn: 'Stage'});
  const result = await notion.connect('ntn_x', fetcher);
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems, [{title: T.databases.NOTION_APPLICATIONS_DB, missing: ['Stage']}]);
});

test('markdown becomes Notion blocks: headings, lists, tables, bold', () => {
  const blocks = notion.markdownBlocks('# Hard constraints\n- **EU citizen**\n1. First\n| Field | Answer |\n|---|---|\n| Notice | 1 month |\nPlain `code`');
  assert.deepEqual(blocks.map(b => b.type), ['heading_1', 'bulleted_list_item', 'numbered_list_item', 'table', 'paragraph']);
  assert.equal(blocks[1].bulleted_list_item.rich_text[0].annotations.bold, true);
  assert.equal(blocks[3].table.children.length, 2);
  assert.equal(blocks[3].table.table_width, 2);
});

test('writing a page replaces its old blocks', async () => {
  const {calls, fetcher} = fakeNotion();
  const count = await notion.writePage('ntn_x', 'page1', '# Profile\n- line', fetcher);
  assert.equal(count, 2);
  assert.deepEqual(calls.filter(c => c.method === 'DELETE').map(c => c.route), ['blocks/b1', 'blocks/b2']);
  assert.equal(calls.at(-1).body.children.length, 2);
});

test('right after access is given, Connect waits while Notion shares the databases, then succeeds', async () => {
  const notion = await import('../lib/notion.js');
  const names = ['A', 'B', 'C', 'D'];
  const answers = [2, 3, 4].map(n => ({ids: Object.fromEntries(names.slice(0, n).map(k => [k, k.toLowerCase()])),
    missing: names.slice(n), problems: []})).map(r => ({...r, ok: !r.missing.length}));
  const progress = [];
  let slept = 0;
  const result = await notion.connectWaiting('ntn_x', {check: async () => answers.shift(), sleep: async () => { slept++; },
    onProgress: p => progress.push(`${p.found}/${p.total}`)});
  assert.equal(result.ok, true);
  assert.deepEqual(progress, ['2/4', '3/4']);
  assert.equal(slept, 2);
});

test('nothing shared at all: Connect stops after a short wait and says so', async () => {
  const notion = await import('../lib/notion.js');
  let calls = 0;
  const result = await notion.connectWaiting('ntn_x', {check: async () => { calls++; return {ok: false, ids: {}, missing: ['A', 'B'], problems: []}; },
    sleep: async () => {}});
  assert.equal(result.ok, false);
  assert.equal(calls, 3);  // two waits, then the answer
});

test('rewriting a page skips blocks that are already gone and reports progress', async () => {
  const notion = await import('../lib/notion.js');
  const calls = [];
  const fetcher = async (url, {method}) => {
    calls.push(`${method} ${url.split('/v1/')[1]}`);
    const reply = (status, body) => ({ok: status < 300, status, json: async () => body});
    if (method === 'GET') return reply(200, {results: [{id: 'a'}, {id: 'b'}], has_more: false});
    if (method === 'DELETE' && url.endsWith('/b')) return reply(400, {message: "Can't edit block that is archived."});
    return reply(200, {});
  };
  const progress = [];
  await notion.writePage('ntn_x', 'page', '# Title\n\nText', fetcher, (done, total) => progress.push(`${done}/${total}`));
  assert.deepEqual(calls, ['GET blocks/page/children?page_size=100', 'DELETE blocks/a', 'DELETE blocks/b', 'PATCH blocks/page/children']);
  assert.deepEqual(progress, ['1/3', '2/3', '3/3']);
});
