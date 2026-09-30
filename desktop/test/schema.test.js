// The workspace as code: whatever config/notion_schema.json lists and the user's Notion lacks is added.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {renameFor, repair, load} from '../lib/schema.js';

const SCHEMA = {
  databases: {
    APPS: {title: 'Applications', icon: '💠', columns: {Job: {type: 'title'}, Stage: {type: 'select', options: [{name: 'Applied', color: 'blue'}]},
      'Applied on': {type: 'date'}}},
    EVENTS: {title: 'Events', columns: {Event: {type: 'title'}, At: {type: 'date'},
      Application: {type: 'relation', database: 'APPS', synced_property: 'Events'},
      'Applied on': {type: 'rollup', relation: 'Application', property: 'Applied on', function: 'show_original'}}},
  },
  pages: {NOTION_PROFILE_PAGE_ID: {emoji: '👤', title: 'Profile'}, PIPELINE: {emoji: '🎯', title: 'Pipeline'},
    SETTINGS: {emoji: '⚙️', title: 'Search settings', made_by: 'src/notion/search_settings.py'}},
};

// A fake Notion holding databases (their columns) and pages.
function fakeWorkspace(databases, choices = {}, titles = {}) {
  const calls = [];
  let next = 1;
  const fetcher = async (url, init = {}) => {
    const route = url.replace('https://api.notion.com/v1/', '');
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push(`${init.method} ${route}`);
    let data = {};
    if (init.method === 'GET' && route.startsWith('pages/')) data = {parent: {page_id: 'root'}};
    else if (init.method === 'GET' && route.startsWith('databases/')) {
      const id = route.split('/')[1];
      data = {properties: Object.fromEntries([...databases[id]].map(n => [n, choices[`${id}/${n}`]
        ? {type: 'select', select: {options: choices[`${id}/${n}`].map(label => ({id: `id-${label}`, name: label}))}} : {}])),
        ...(titles[id] ? {title: [{plain_text: titles[id].title}], description: [{plain_text: titles[id].description || ''}]} : {})};
    }
    else if (init.method === 'POST' && route === 'databases') {
      const id = `db${next++}`;
      databases[id] = new Set(Object.keys(body.properties));
      data = {id};
    } else if (init.method === 'PATCH' && route.startsWith('databases/')) {
      const id = route.split('/')[1];
      if (body.title) titles[id] = {title: body.title.map(t => t.text.content).join(''), description: (body.description || []).map(t => t.text.content).join('')};
      for (const [name, prop] of Object.entries(body.properties || {})) {
        if (prop === null) { databases[id].delete(name); continue; }  // a retired column removed
        if (prop.select && databases[id].has(name)) { choices[`${id}/${name}`] = prop.select.options.map(o => o.name); continue; }
        if (prop.name) { databases[id].delete(name); databases[id].add(prop.name); continue; }
        databases[id].add(name);
        if (prop.relation?.type === 'dual_property') databases[prop.relation.database_id].add('Related to Events (Application)');
      }
    } else if (init.method === 'POST' && route === 'pages') data = {id: `page${next++}`};
    return {ok: true, json: async () => data};
  };
  return {calls, fetcher};
}

test('a workspace missing a column, a database and a page gets them from the schema', async () => {
  const databases = {apps: new Set(['Job', 'Stage'])};  // "Applied on" was deleted; Events never existed
  const {calls, fetcher} = fakeWorkspace(databases);
  const fixed = await repair('ntn_x', {APPS: 'apps', NOTION_PROFILE_PAGE_ID: 'profile'}, SCHEMA, fetcher);
  assert.deepEqual(fixed.created, ['Events', 'Pipeline']);  // Search settings is made by its own module
  assert.deepEqual(fixed.columns, ['Applications: Applied on', 'Events: Application', 'Events: Applied on']);
  assert.deepEqual([...databases.apps].sort(), ['Applied on', 'Events', 'Job', 'Stage']);  // the two-way relation's other side, named as in the schema
  assert.deepEqual([...databases[fixed.ids.EVENTS]].sort(), ['Application', 'Applied on', 'At', 'Event']);
  assert.ok(fixed.ids.PIPELINE);
  // Nothing left to do the second time.
  const again = await repair('ntn_x', fixed.ids, SCHEMA, fetcher);
  assert.deepEqual([again.created, again.columns], [[], []]);
  assert.ok(!calls.some(call => call.startsWith('DELETE')));  // never deletes anything
});

test('an existing select column gets the choices the schema added, keeping its own', async () => {
  const databases = {apps: new Set(['Job', 'Stage', 'Applied on'])};
  const choices = {'apps/Stage': ['Saved', 'Applied']};  // "Recruiter lead" is new in the schema
  const {calls, fetcher} = fakeWorkspace(databases, choices);
  const schema = {databases: {APPS: {title: 'Applications', columns: {Job: {type: 'title'}, 'Applied on': {type: 'date'},
    Stage: {type: 'select', options: [{name: 'Applied', color: 'blue'}, {name: 'Recruiter lead', color: 'purple'}]}}}}, pages: {}};
  const fixed = await repair('ntn_x', {APPS: 'apps', NOTION_PROFILE_PAGE_ID: 'profile'}, schema, fetcher);
  assert.deepEqual(fixed.columns, ['Applications: Stage → Recruiter lead']);
  assert.deepEqual(choices['apps/Stage'], ['Saved', 'Applied', 'Recruiter lead']);  // "Saved" (not in the schema) kept
  const again = await repair('ntn_x', fixed.ids, schema, fetcher);
  assert.deepEqual(again.columns, []);
  assert.ok(!calls.some(call => call.startsWith('DELETE')));
});

test('columns the schema retired are removed where they still exist, once; other columns stay', async () => {
  const databases = {runs: new Set(['Run', 'AI cost (USD)', 'Cost mail (USD)', 'Emails', 'My own column'])};
  const {fetcher} = fakeWorkspace(databases);
  const schema = {databases: {RUNS: {title: 'Cronjob Runs', columns: {Run: {type: 'title'}, 'AI cost (USD)': {type: 'number'}, Details: {type: 'rich_text'}},
    retired: ['Cost mail (USD)', 'Emails', 'Kits']}}, pages: {}};
  const fixed = await repair('ntn_x', {RUNS: 'runs', NOTION_PROFILE_PAGE_ID: 'profile'}, schema, fetcher);
  assert.deepEqual(fixed.columns.sort(), ['Cronjob Runs: Cost mail (USD) (removed)', 'Cronjob Runs: Details', 'Cronjob Runs: Emails (removed)']);
  assert.deepEqual([...databases.runs].sort(), ['AI cost (USD)', 'Details', 'My own column', 'Run']);  // the user's own column kept
  const again = await repair('ntn_x', fixed.ids, schema, fetcher);
  assert.deepEqual(again.columns, []);
});

test('the committed schema (once snapshotted) covers every column the app requires', () => {
  const schema = load();
  if (!schema) return;  // not snapshotted yet: tools/notion_schema.py snapshot
  const template = JSON.parse(fs.readFileSync(new URL('../../config/notion_template.json', import.meta.url), 'utf8'));
  for (const [env, required] of Object.entries(template.required_properties)) {
    for (const name of required) assert.ok(schema.databases[env]?.columns[name], `${env}: ${name}`);
  }
});

test('a new workspace is built from the schema inside the one empty page the connection can see', async () => {
  const databases = {};
  const {fetcher} = fakeWorkspace(databases);
  const built = await repair('ntn_x', {}, SCHEMA, fetcher, 'empty-page');
  assert.deepEqual(built.created, ['Applications', 'Events', 'Profile', 'Pipeline']);
  assert.ok(built.ids.APPS && built.ids.EVENTS && built.ids.NOTION_PROFILE_PAGE_ID && built.ids.PIPELINE);
  assert.deepEqual([...databases[built.ids.EVENTS]].sort(), ['Application', 'Applied on', 'At', 'Event']);
  assert.equal(built.ids.SETTINGS, undefined);  // made later by its own module
});

test('the page to build in: exactly one top-level page shared with the connection', async () => {
  const {sharedRoot} = await import('../lib/notion.js');
  const search = pages => async () => ({ok: true, json: async () => ({results: pages, has_more: false})});
  const page = (id, parent) => ({object: 'page', id, parent, properties: {}});
  assert.equal(await sharedRoot('t', search([page('root-1', {type: 'workspace'}), page('child', {page_id: 'root-1'})])), 'root1');
  assert.equal(await sharedRoot('t', search([page('a', {type: 'workspace'}), page('b', {type: 'workspace'})])), null);
  assert.equal(await sharedRoot('t', search([])), null);
});

test('a database still called by a former title gets the new title and description, once; a title of your own stays', async () => {
  const schema = {databases: {APPS: {title: 'Job Tracker', former_titles: ['Applications — Job Tracker'], description: 'One row per opportunity.',
    columns: {Job: {type: 'title'}}}}, pages: {}};
  const titles = {apps: {title: '💠 Applications — Job Tracker', description: 'One row per job applied to or saved.'}};
  const {calls, fetcher} = fakeWorkspace({apps: new Set(['Job'])}, {}, titles);
  const fixed = await repair('ntn_x', {APPS: 'apps', NOTION_PROFILE_PAGE_ID: 'profile'}, schema, fetcher);
  assert.deepEqual(fixed.renamed, ['💠 Applications — Job Tracker → Job Tracker']);
  assert.deepEqual(titles.apps, {title: 'Job Tracker', description: 'One row per opportunity.'});
  assert.equal(fixed.ids.APPS, 'apps');  // the same database, found by its id: nothing created
  assert.deepEqual(fixed.created, []);
  const before = calls.length;
  const again = await repair('ntn_x', fixed.ids, schema, fetcher);
  assert.deepEqual(again.renamed, []);
  assert.ok(!calls.slice(before).some(call => call.startsWith('PATCH')));
  // Renamed by the user: never touched.
  const own = {apps: {title: 'My applications'}};
  const mine = fakeWorkspace({apps: new Set(['Job'])}, {}, own);
  assert.deepEqual((await repair('ntn_x', {APPS: 'apps', NOTION_PROFILE_PAGE_ID: 'profile'}, schema, mine.fetcher)).renamed, []);
  assert.equal(own.apps.title, 'My applications');
});

test('the committed schema renames the old Applications title, and the app still finds a copy that has it', async () => {
  const committed = load();
  const apps = committed.databases.NOTION_APPLICATIONS_DB;
  assert.equal(apps.title, 'Job Tracker');
  assert.ok(renameFor(apps, 'Applications — Job Tracker'));
  assert.equal(renameFor(apps, 'Job Tracker'), null);
  assert.match(apps.description, /^One row per opportunity: applied, saved or inbound\./);
  const {discover} = await import('../lib/notion.js');
  const found = (title, id) => ({object: 'database', id, title: [{plain_text: title}], parent: {page_id: 'root'}, last_edited_time: '2026-09-30'});
  for (const title of ['Applications — Job Tracker', 'Job Tracker']) {
    const fetcher = async (url, init) => ({ok: true, json: async () => ({has_more: false,
      results: JSON.parse(init.body).filter.value === 'database' ? [found(title, 'apps-1')] : []})});
    assert.equal((await discover('t', fetcher)).ids.NOTION_APPLICATIONS_DB, 'apps1', title);
  }
});
