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
  let pageBlocks = ['b1', 'b2'];   // what a page holds: a delete removes a block
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
    if (route.startsWith('blocks/') && init.method === 'GET') return reply({results: pageBlocks.map(id => ({id})), has_more: false});
    if (route.startsWith('blocks/') && init.method === 'DELETE') pageBlocks = pageBlocks.filter(id => route !== `blocks/${id}`);
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
  let blocks = ['a', 'b'];
  const fetcher = async (url, {method}) => {
    calls.push(`${method} ${url.split('/v1/')[1]}`);
    const reply = (status, body) => ({ok: status < 300, status, json: async () => body});
    if (method === 'GET') return reply(200, {results: blocks.map(id => ({id})), has_more: false});
    if (method === 'DELETE') { blocks = blocks.filter(id => !url.endsWith(`/${id}`)); }
    if (method === 'DELETE' && url.endsWith('/b')) return reply(400, {message: "Can't edit block that is archived."});   // gone already
    return reply(200, {});
  };
  const progress = [];
  await notion.writePage('ntn_x', 'page', '# Title\n\nText', fetcher, (done, total) => progress.push(`${done}/${total}`));
  assert.deepEqual(calls, ['GET blocks/page/children?page_size=100', 'DELETE blocks/a', 'DELETE blocks/b', 'GET blocks/page/children?page_size=100', 'PATCH blocks/page/children']);
  assert.deepEqual(progress, ['1/3', '2/3', '3/3']);
});

// 2 Oct 2026: Notion answered "Can't edit block that is archived" to a DELETE of blocks that were still on the page; the old copy stayed, the new one
// was appended beside it and the two copies of ⚙️ Search settings were merged into one list (an Austin analyst got São Paulo's places and work rights).
test('a block Notion refuses to delete is deleted again, and nothing is appended until the page is empty', async () => {
  const notion = await import('../lib/notion.js');
  notion.rewriteTuning.waitMs = 0;
  let blocks = ['a', 'b', 'c'];
  const appended = [];
  let refusals = 0;
  const fetcher = async (url, {method}) => {
    const reply = (status, body) => ({ok: status < 300, status, json: async () => body});
    if (method === 'GET') return reply(200, {results: blocks.map(id => ({id})), has_more: false});
    if (method === 'DELETE') {
      if (!url.endsWith('/a') && refusals++ < 2) return reply(400, {message: "Can't edit block that is archived."});   // refused, still on the page
      blocks = blocks.filter(id => !url.endsWith(`/${id}`));
      return reply(200, {});
    }
    appended.push([...blocks]);   // what was on the page when the new content was appended
    return reply(200, {});
  };
  await notion.writePage('ntn_x', 'page', '# Title\n- one', fetcher);
  assert.deepEqual(appended, [[]]);
});

// 2 Oct 2026 (strategy e2e): "The start_cursor provided is invalid" while a page's blocks were listed. Notion's cursor is the id of a block; if that block is
// archived by another writer between two reads, the cursor dies and the whole save failed ("Couldn't write to Notion"). The listing starts again from the top.
test('a page listing whose cursor goes stale is read again from the start, not failed', async () => {
  const notion = await import('../lib/notion.js');
  notion.rewriteTuning.waitMs = 0;
  let staleOnce = true, blocks = ['a', 'b', 'c'];
  const appended = [];
  const fetcher = async (url, {method}) => {
    const reply = (status, body) => ({ok: status < 300, status, json: async () => body});
    if (method === 'GET') {
      if (url.includes('start_cursor=')) {
        if (staleOnce) { staleOnce = false; return reply(400, {code: 'validation_error', message: 'The start_cursor provided is invalid: cur1'}); }
        return reply(200, {results: blocks.slice(1).map(id => ({id})), has_more: false});
      }
      return reply(200, staleOnce ? {results: [{id: 'a'}], has_more: true, next_cursor: 'cur1'} : {results: blocks.map(id => ({id})), has_more: false});
    }
    if (method === 'DELETE') { blocks = blocks.filter(id => !url.endsWith(`/${id}`)); return reply(200, {}); }
    appended.push([...blocks]);
    return reply(200, {});
  };
  await notion.writePage('ntn_x', 'page', '# Title\n- one', fetcher);
  assert.deepEqual(appended, [[]], 'every old block was deleted before the new content went in');
});

test('a page that keeps its old blocks is not written to, and the failure says so', async () => {
  const notion = await import('../lib/notion.js');
  notion.rewriteTuning.waitMs = 0;
  const methods = [];
  const fetcher = async (url, {method}) => {
    methods.push(method);
    const reply = (status, body) => ({ok: status < 300, status, json: async () => body});
    if (method === 'GET') return reply(200, {results: [{id: 'a'}], has_more: false});
    if (method === 'DELETE') return reply(400, {message: "Can't edit block that is archived."});
    return reply(200, {});
  };
  await assert.rejects(notion.writePage('ntn_x', 'page', '# Title', fetcher), /kept 1 old block/);
  assert.ok(!methods.includes('PATCH'), 'the new content is not appended beside the old');
});

test('two rewrites of the same page never interleave, so a page is never left with its content twice', async () => {
  const notion = await import('../lib/notion.js');
  const log = [];
  let content = ['old'];
  const fetcher = async (url, {method, body}) => {
    const reply = (status, data) => ({ok: status < 300, status, json: async () => data});
    await new Promise(resolve => setTimeout(resolve, 2));   // a real network gives the other write its chance to start
    if (method === 'GET') { log.push('read'); return reply(200, {results: content.map(id => ({id})), has_more: false}); }
    if (method === 'DELETE') { content = content.filter(id => !url.endsWith(`/${id}`)); return reply(200, {}); }
    if (method === 'PATCH') { content.push(...JSON.parse(body).children.map((_, i) => `new${content.length}-${i}`)); log.push('append'); return reply(200, {}); }
    return reply(200, {});
  };
  await Promise.all([notion.writePage('t', 'page', '# A\n- one', fetcher), notion.writePage('t', 'page', '# A\n- one', fetcher)]);
  assert.deepEqual(log, ['read', 'read', 'append', 'read', 'read', 'append']);   // the second read waits for the first append; each write checks that its delete took
  assert.equal(content.filter(id => id.startsWith('new')).length, 2);   // one write's blocks only: the second replaced the first's
});

test('a block that stays in the page\'s list but is gone does not stop the rewrite', async () => {
  const notion = await import('../lib/notion.js');
  notion.rewriteTuning.waitMs = 0;
  const methods = [];
  const fetcher = async (url, {method}) => {
    methods.push(method);
    const reply = (status, body) => ({ok: status < 300, status, json: async () => body});
    if (method === 'GET' && url.includes('/children')) return reply(200, {results: [{id: 'ghost'}], has_more: false});
    if (method === 'GET') return reply(200, {id: 'ghost', archived: true});   // asked about by itself: it is gone
    if (method === 'DELETE') return reply(400, {message: "Can't edit block that is archived."});
    return reply(200, {});
  };
  await notion.writePage('ntn_x', 'page', '# Title', fetcher);
  assert.ok(methods.includes('PATCH'), 'the new content is written');
});

// 2 Oct 2026 (found by the Focus e2e): Notion listed a page's blocks from before its previous rewrite, so the rewrite deleted nothing, appended
// its blocks beside the old ones, and "Daily applications target" held "5" above the new "3": the engine read the first one and the change was lost.
test('a rewrite that was given a stale block list removes the old blocks afterwards', async () => {
  const notion = await import('../lib/notion.js');
  let content = ['old1', 'old2'];
  let reads = 0;
  const fetcher = async (url, {method, body}) => {
    const reply = (status, data) => ({ok: status < 300, status, json: async () => data});
    if (method === 'GET') { reads++; return reply(200, {results: (reads === 1 ? [] : content).map(id => ({id})), has_more: false}); }   // the first listing is stale: empty
    if (method === 'DELETE') { content = content.filter(id => !url.endsWith(`/${id}`)); return reply(200, {}); }
    if (method === 'PATCH') {
      const added = JSON.parse(body).children.map((_, i) => `new${i}`);
      content.push(...added);
      return reply(200, {results: added.map(id => ({id}))});
    }
    return reply(200, {});
  };
  await notion.writePage('t', 'page', '# Daily applications target\n- 3', fetcher);
  assert.deepEqual(content, ['new0', 'new1'], 'only the new blocks are left');
});

// 7 Oct 2026: one place removed from ⚙️ Search settings took 71 s, all 107 blocks deleted and written again one by one.
function fakePage(texts) {
  let next = 0;
  const block = text => ({id: `k${next++}`, type: 'bulleted_list_item', bulleted_list_item: {rich_text: [{type: 'text', text: {content: text}, plain_text: text, annotations: {bold: false, code: false}}]}});
  let page = texts.map(block);
  const calls = [];
  const fetcher = async (url, {method, body}) => {
    const route = url.split('/v1/')[1];
    calls.push(`${method} ${route.split('?')[0]}`);
    const reply = body => ({ok: true, status: 200, json: async () => body});
    if (method === 'GET') return reply({results: page, has_more: false});
    if (method === 'DELETE') { page = page.filter(item => !route.endsWith(item.id)); return reply({}); }
    const {children, after} = JSON.parse(body);
    const made = children.map(child => ({...child, id: `k${next++}`}));
    const at = after ? page.findIndex(item => item.id === after) + 1 : page.length;
    page.splice(at, 0, ...made);
    return reply({results: made});
  };
  return {calls, fetcher, texts: () => page.map(item => item.bulleted_list_item.rich_text[0].text.content)};
}

test('a page rewrite changes only the blocks that changed, and reads back as written', async () => {
  const notion = await import('../lib/notion.js');
  const lines = Array.from({length: 100}, (_, i) => `setting ${i}`);
  const page = fakePage(lines);
  const progress = [];
  await notion.writePage('ntn_x', 'page', lines.filter(line => line !== 'setting 50').map(line => `- ${line}`).join('\n'), page.fetcher, (done, total) => progress.push(`${done}/${total}`));
  assert.deepEqual(page.calls, ['GET blocks/page/children', 'DELETE blocks/k50', 'GET blocks/page/children'], 'one delete, not 100 deletes and a rewrite');
  assert.deepEqual(page.texts(), lines.filter(line => line !== 'setting 50'));
  assert.deepEqual(progress, ['1/1']);

  const added = fakePage(['a', 'b', 'c']);
  await notion.writePage('ntn_x', 'page', '- a\n- b2\n- b3\n- c', added.fetcher);
  assert.deepEqual(added.texts(), ['a', 'b2', 'b3', 'c']);
  assert.deepEqual(added.calls.filter(call => !call.startsWith('GET')), ['DELETE blocks/k1', 'PATCH blocks/page/children']);
});

test('a patch that does not read back as written falls back to the whole rewrite', async () => {
  const notion = await import('../lib/notion.js');
  notion.rewriteTuning.waitMs = 0;
  const page = fakePage(['a', 'b', 'c']);
  let lag = true;
  const fetcher = async (url, init) => {
    if (init.method === 'DELETE' && lag) { lag = false; return {ok: true, status: 200, json: async () => ({})}; }   // the delete did not stick
    return page.fetcher(url, init);
  };
  await notion.writePage('ntn_x', 'page', '- a\n- c', fetcher);
  assert.deepEqual(page.texts(), ['a', 'c']);
});

test('two edits far apart touch only those blocks, each new one after its neighbour', async () => {
  const notion = await import('../lib/notion.js');
  const lines = Array.from({length: 60}, (_, i) => `setting ${i}`);
  const page = fakePage(lines);
  const want = lines.map(line => (line === 'setting 5' ? 'setting 5 changed' : line)).filter(line => line !== 'setting 55').concat('setting 60');
  await notion.writePage('ntn_x', 'page', want.map(line => `- ${line}`).join('\n'), page.fetcher);
  assert.deepEqual(page.texts(), want);
  assert.deepEqual(page.calls.filter(call => !call.startsWith('GET')), ['DELETE blocks/k5', 'DELETE blocks/k55', 'PATCH blocks/page/children', 'PATCH blocks/page/children']);
});
