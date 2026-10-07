// Starting over (Settings → Danger zone) and exporting (Settings → Your data) with Notion: an archived workspace
// is renamed and never connected to again; an export can carry a copy of the whole workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as notion from '../lib/notion.js';
import * as reset from '../lib/reset.js';
import {createStorage} from '../lib/storage.js';

const T = notion.TEMPLATE;
const title = text => [{plain_text: text, text: {content: text}}];
const page = (id, parent, name) => ({object: 'page', id, parent: {page_id: parent}, last_edited_time: '2026-09-28',
  properties: {title: {type: 'title', title: title(name)}}});
const database = (id, parent, name) => ({object: 'database', id, parent: {page_id: parent}, last_edited_time: '2026-09-28', title: title(name)});

// Two workspaces shared with one connection: the old one (root "old") and a new empty page ("new").
function workspace({oldTitle = 'Job Pilotto', rows = 2} = {}) {
  const items = [page('old', null, oldTitle), page('new', null, 'Job Pilotto')];
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

test('archiving renames the workspace page, and connecting then ignores everything inside it', async () => {
  const w = workspace();
  const before = await notion.discover('t', w.fetcher);
  assert.equal(before.missing.length, 0);
  assert.equal(await notion.sharedRoot('t', w.fetcher), null);  // two top pages: not a fresh start yet
  const done = await notion.archiveWorkspace('t', before.ids, '28 Sep 2026', w.fetcher);
  assert.equal(done.title, 'Job Pilotto (archived 28 Sep 2026)');
  assert.deepEqual(w.patched, ['pages/old']);  // only the root page's title changed: nothing deleted
  const after = await notion.discover('t', w.fetcher);
  assert.deepEqual(after.ids, {});
  assert.equal(await notion.sharedRoot('t', w.fetcher), 'new');  // the setup builds the new workspace here
});

test('archiving twice keeps one "(archived …)" suffix; renaming it back brings the workspace back', async () => {
  const w = workspace({oldTitle: 'My jobs (archived 1 Jan 2026)'});
  assert.deepEqual((await notion.discover('t', w.fetcher)).ids, {});
  w.items[0].properties.title.title = title('My jobs');
  const ids = (await notion.discover('t', w.fetcher)).ids;
  assert.ok(ids.NOTION_PROFILE_PAGE_ID);
  assert.equal((await notion.archiveWorkspace('t', ids, '28 Sep 2026', w.fetcher)).title, 'My jobs (archived 28 Sep 2026)');
});

test('an export carries no Notion copy; an older one that does imports without keeping it (owner, 8 Oct 2026)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-'));
  const dir = path.join(base, 'Job Pilotto');
  createStorage(dir, {encrypt: v => v, decrypt: v => v}).saveSettings({setupDone: true});
  const file = path.join(base, 'export.tar.gz');
  reset.exportTo(dir, file);
  reset.stageImport(dir, file);
  assert.ok(!fs.existsSync(path.join(`${dir} (import)`, reset.NOTION_FILE)), 'no Notion copy in a new export');
  fs.writeFileSync(path.join(`${dir} (import)`, reset.NOTION_FILE), '{}');   // as an older export carried it
  assert.equal(reset.applyPending(dir).imported, true);
  assert.ok(!fs.existsSync(path.join(dir, reset.NOTION_FILE)));
});

test('a fresh-start reset remembers the archived page for the message after the restart', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-'));
  const dir = path.join(base, 'Job Pilotto');
  fs.mkdirSync(dir);
  reset.request(dir, {backup: false, archived: {title: 'Job Pilotto (archived 28 Sep 2026)', url: 'u'}});
  assert.deepEqual(reset.applyPending(dir), {deleted: true, archived: {title: 'Job Pilotto (archived 28 Sep 2026)', url: 'u'}});
});

// Two installs that each connected the same Notion left two pages both called "Job Pilotto" (6 Oct 2026): a page made by a connect is
// named after the computer and the day; a page the user named is never renamed.
test('a new workspace page is named after this computer and today; a page with its own name is kept', async () => {
  assert.equal(notion.workspaceTitle("Igor's MacBook Pro", new Date(2026, 9, 7)), "Job Pilotto · Igor's MacBook Pro · 7 Oct 2026");
  assert.equal(notion.workspaceTitle('', new Date(2026, 9, 7)), 'Job Pilotto · 7 Oct 2026');
  const w = workspace();
  const ids = (await notion.discover('t', w.fetcher)).ids;
  const named = await notion.nameWorkspace('t', ids, "Job Pilotto · Igor's MacBook Pro · 7 Oct 2026", w.fetcher);
  assert.deepEqual([named.renamed, w.patched], [true, ['pages/old']]);
  assert.ok((await notion.discover('t', w.fetcher)).ids.NOTION_PROFILE_PAGE_ID, 'still found after the rename');
  const mine = workspace({oldTitle: 'My jobs'});
  const again = await notion.nameWorkspace('t', (await notion.discover('t', mine.fetcher)).ids, 'Job Pilotto · X · 7 Oct 2026', mine.fetcher);
  assert.deepEqual([again.renamed, again.title, mine.patched], [false, 'My jobs', []]);
});
