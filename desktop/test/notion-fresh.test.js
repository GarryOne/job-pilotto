// Notion and starting over (Settings → Danger zone) or exporting (Settings → Your data): a reset never calls Notion; a workspace
// an older reset renamed "(archived …)" is never connected to again; an export carries no Notion copy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as notion from '../lib/notion.js';
import {connectWorkspace} from '../lib/notion-workspace.js';
import * as reset from '../lib/reset.js';
import {createStorage} from '../lib/storage.js';

const T = notion.TEMPLATE;
const title = text => [{plain_text: text, text: {content: text}}];
const page = (id, parent, name) => ({object: 'page', id, parent: {page_id: parent}, last_edited_time: '2026-09-28',
  properties: {title: {type: 'title', title: title(name)}}});
const database = (id, parent, name) => ({object: 'database', id, parent: {page_id: parent}, last_edited_time: '2026-09-28', title: title(name)});

// Two workspaces shared with one connection: the old one (root "old") and a new empty page ("new").
function workspace({oldTitle = 'Jobadabra', rows = 2} = {}) {
  const items = [page('old', null, oldTitle), page('new', null, 'Jobadabra')];
  for (const [env, name] of Object.entries(T.databases)) items.push(database(`db_${env}`, 'old', name));
  for (const [env, name] of Object.entries(T.pages)) items.push(page(`pg_${env}`, 'old', name));
  items[0].parent = {type: 'workspace', workspace: true};
  items[1].parent = {type: 'workspace', workspace: true};
  const patched = [];
  let throttled = false;
  const fetcher = async (url, init = {}) => {
    const route = url.replace('https://api.notion.com/v1/', '').split('?')[0];
    const body = init.body ? JSON.parse(init.body) : {};
    const reply = data => ({ok: true, json: async () => data});
    if (route === 'search') return reply({results: items.filter(i => i.object === body.filter.value), has_more: false});
    if (init.method === 'PATCH' && route.startsWith('pages/')) {
      const target = items.find(i => `pages/${i.id}` === route);
      target.properties.title.title = title(body.properties.title.title[0].text.content);
      patched.push(route);
      return reply(target);
    }
    if (route.startsWith('pages/')) return reply(items.find(i => `pages/${i.id}` === route));
    if (route === 'blocks/old/children') {
      if (!throttled) { throttled = true; return {ok: false, status: 429, json: async () => ({message: 'rate limited'})}; }
      return reply({results: [{id: 'dbx', type: 'child_database', has_children: false}, {id: 'sub', type: 'child_page', has_children: true, child_page: {title: 'Notes'}},
        {id: 'parked', type: 'child_page', has_children: true, child_page: {title: 'Wizard build (archived 28 Sep 2026)'}}], has_more: false});
    }
    if (route === 'blocks/sub/children') return reply({results: [{id: 'p1', type: 'paragraph', has_children: false}], has_more: false});
    if (/^blocks\/row\d\/children$/.test(route)) return reply({results: [{id: 'note', type: 'paragraph', has_children: false}], has_more: false});
    if (route === 'databases/dbx') return reply({id: 'dbx', properties: {Name: {type: 'title'}}});
    if (route === 'databases/dbx/query') return reply({results: Array.from({length: rows}, (_, n) => ({id: `row${n}`})), has_more: false});
    return reply({});
  };
  return {items, fetcher, patched};
}

// A reset only clears this Mac (owner, 16 Oct 2026: "a reset for sure shouldn't touch the current Notion"). Connecting Notion afterwards is the normal first-time flow.
test('a reset never reaches Notion: no archive call, no checkbox, no remembered page', () => {
  assert.equal(notion.archiveWorkspace, undefined, 'nothing renames a Notion page any more');
  const here = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  assert.ok(!/import .*['"]\.\/notion\.js['"]/.test(here('../lib/system-handlers.js')), 'the reset handlers do not import the Notion client');
  assert.ok(!/freshNotion|archived/.test(here('../lib/system-handlers.js')));
  assert.ok(!/reset-notion|fresh Notion/i.test(here('../renderer/index.html') + here('../renderer/pages/data.js')), 'no "fresh Notion workspace" option');
  assert.match(here('../renderer/index.html'), /Your Notion and GitHub are not touched/);
});

test('a page already renamed "(archived …)" by an older reset is still never connected to', async () => {
  const w = workspace({oldTitle: 'My jobs (archived 1 Jan 2026)'});
  assert.deepEqual((await notion.discover('t', w.fetcher)).ids, {});
  assert.equal(await notion.sharedRoot('t', w.fetcher), 'new');
});

// Owner, 16 Oct 2026 ("Always start new"): a fresh profile never discovers or reuses an existing Jobadabra page; it builds a new one beside it.
const built = [];
const fakeRepair = async (_token, ids, _schema, _fetcher, page) => { built.push(page); return {ids: {NOTION_PROFILE_PAGE_ID: `${page}-profile`}, created: ['Profile'], columns: []}; };
const noWait = {sleep: async () => {}, every: 0};
// The fixture's databases answer the column check too (every column the pipeline needs).
const withColumns = fetcher => async (url, init) => {
  const id = url.replace('https://api.notion.com/v1/', '').split('?')[0].match(/^databases\/(db_\w+)$/)?.[1];
  const env = id?.slice(3);
  if (!env) return fetcher(url, init);
  return {ok: true, json: async () => ({id, properties: Object.fromEntries((T.required_properties[env] || []).map(name => [name, {type: 'rich_text'}]))})};
};

test('a fresh connect builds a new workspace beside an existing one and leaves the old page untouched', async () => {
  built.length = 0;
  const w = workspace();   // the old workspace (root "old", every database) and an empty shared page ("new")
  const result = await connectWorkspace('t', {fresh: true, fetcher: withColumns(w.fetcher), repair: fakeRepair, ...noWait});
  assert.deepEqual(built, ['new'], 'built in the new page, never in the old one');
  assert.equal(result.ok, true);
  assert.ok(!Object.values(result.ids).some(id => id.startsWith('old') || id.startsWith('db_') || id.startsWith('pg_')), 'none of the old workspace is reused');
  assert.deepEqual(w.patched, [], 'the old page was not renamed, archived or changed');
});

test('a fresh connect with only the old workspace shared builds nothing and touches nothing', async () => {
  built.length = 0;
  const w = workspace();
  w.items.splice(1, 1);   // the new page is not shared
  const result = await connectWorkspace('t', {fresh: true, fetcher: withColumns(w.fetcher), repair: fakeRepair, ...noWait});
  assert.deepEqual([result.ok, built, w.patched], [false, [], []]);
});

test('a connect that is not fresh (this profile already has its workspace) still finds it', async () => {
  built.length = 0;
  const w = workspace();
  const result = await connectWorkspace('t', {fetcher: withColumns(w.fetcher), repair: fakeRepair, ...noWait});
  assert.equal(result.ok, true);
  assert.equal(result.ids.NOTION_PROFILE_PAGE_ID, 'pg_NOTION_PROFILE_PAGE_ID');
  assert.deepEqual(built, []);
});

test('an export carries no Notion copy; an older one that does imports without keeping it (owner, 8 Oct 2026)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-'));
  const dir = path.join(base, 'Jobadabra');
  createStorage(dir, {encrypt: v => v, decrypt: v => v}).saveSettings({setupDone: true});
  const file = path.join(base, 'export.tar.gz');
  reset.exportTo(dir, file);
  reset.stageImport(dir, file);
  assert.ok(!fs.existsSync(path.join(`${dir} (import)`, reset.NOTION_FILE)), 'no Notion copy in a new export');
  fs.writeFileSync(path.join(`${dir} (import)`, reset.NOTION_FILE), '{}');   // as an older export carried it
  assert.equal(reset.applyPending(dir).imported, true);
  assert.ok(!fs.existsSync(path.join(dir, reset.NOTION_FILE)));
});

test('a reset leaves nothing about Notion for after the restart', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-'));
  const dir = path.join(base, 'Jobadabra');
  fs.mkdirSync(dir);
  reset.request(dir);
  assert.deepEqual(reset.applyPending(dir), {deleted: true});
});

// Two installs that each connected the same Notion left two pages both called "Jobadabra" (6 Oct 2026): a page made by a connect is
// named after the computer and the day; a page the user named is never renamed.
test('a new workspace page is named after this computer and today; a page with its own name is kept', async () => {
  assert.equal(notion.workspaceTitle("Igor's MacBook Pro", new Date(2026, 9, 7)), "Jobadabra · Igor's MacBook Pro · 7 Oct 2026");
  assert.equal(notion.workspaceTitle('', new Date(2026, 9, 7)), 'Jobadabra · 7 Oct 2026');
  const w = workspace();
  const ids = (await notion.discover('t', w.fetcher)).ids;
  const named = await notion.nameWorkspace('t', ids, "Jobadabra · Igor's MacBook Pro · 7 Oct 2026", w.fetcher);
  assert.deepEqual([named.renamed, w.patched], [true, ['pages/old']]);
  assert.ok((await notion.discover('t', w.fetcher)).ids.NOTION_PROFILE_PAGE_ID, 'still found after the rename');
  const mine = workspace({oldTitle: 'My jobs'});
  const again = await notion.nameWorkspace('t', (await notion.discover('t', mine.fetcher)).ids, 'Jobadabra · X · 7 Oct 2026', mine.fetcher);
  assert.deepEqual([again.renamed, again.title, mine.patched], [false, 'My jobs', []]);
});
