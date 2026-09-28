// The workspace as code: whatever config/notion_schema.json lists and the user's Notion lacks is added.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {repair, load} from '../lib/schema.js';

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
function fakeWorkspace(databases) {
  const calls = [];
  let next = 1;
  const fetcher = async (url, init = {}) => {
    const route = url.replace('https://api.notion.com/v1/', '');
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push(`${init.method} ${route}`);
    let data = {};
    if (init.method === 'GET' && route.startsWith('pages/')) data = {parent: {page_id: 'root'}};
    else if (init.method === 'GET' && route.startsWith('databases/')) data = {properties: Object.fromEntries([...databases[route.split('/')[1]]].map(n => [n, {}]))};
    else if (init.method === 'POST' && route === 'databases') {
      const id = `db${next++}`;
      databases[id] = new Set(Object.keys(body.properties));
      data = {id};
    } else if (init.method === 'PATCH' && route.startsWith('databases/')) {
      const id = route.split('/')[1];
      for (const [name, prop] of Object.entries(body.properties)) {
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

test('the committed schema (once snapshotted) covers every column the app requires', () => {
  const schema = load();
  if (!schema) return;  // not snapshotted yet: tools/notion_schema.py snapshot
  const template = JSON.parse(fs.readFileSync(new URL('../../config/notion_template.json', import.meta.url), 'utf8'));
  for (const [env, required] of Object.entries(template.required_properties)) {
    for (const name of required) assert.ok(schema.databases[env]?.columns[name], `${env}: ${name}`);
  }
});
