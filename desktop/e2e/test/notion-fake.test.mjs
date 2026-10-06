// The in-memory Notion (lib/notion-fake.mjs): the requests the app makes, in Notion's shapes (docs/notion-surface.md).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createNotionFake} from '../lib/notion-fake.mjs';

const call = (fake, method, path, body = {}, query = '') => fake.handle(method, path, body, new URLSearchParams(query));
const text = value => [{text: {content: value}}];

test('a database, its rows, filtered and paged queries, newest first', () => {
  const fake = createNotionFake();
  const db = call(fake, 'POST', 'databases', {parent: {page_id: fake.root.id}, title: text('Job Tracker'),
    properties: {Job: {title: {}}, Stage: {select: {}}, 'Job URL': {url: {}}, Fit: {number: {}}, Applied: {date: {}}}}).body;
  for (const [i, stage] of ['Saved', 'Applied', 'Applied'].entries())
    call(fake, 'POST', 'pages', {parent: {database_id: db.id}, properties: {Job: {title: text(`Job ${i}`)}, Stage: {select: {name: stage}}, 'Job URL': {url: `https://x/${i}`}, Fit: {number: 70 + i}, Applied: {date: {start: `2026-10-0${i + 1}`}}}});
  const q = filter => call(fake, 'POST', `databases/${db.id}/query`, {filter}).body.results.map(row => row.properties.Job.title[0].plain_text);
  assert.deepEqual(q({property: 'Stage', select: {equals: 'Applied'}}).sort(), ['Job 1', 'Job 2']);
  assert.deepEqual(q({and: [{property: 'Fit', number: {greater_than: 70}}, {property: 'Applied', date: {on_or_after: '2026-10-03'}}]}), ['Job 2']);
  assert.deepEqual(q({or: [{property: 'Job URL', url: {equals: 'https://x/0'}}, {property: 'Job', title: {equals: 'Job 2'}}]}).sort(), ['Job 0', 'Job 2']);
  const first = call(fake, 'POST', `databases/${db.id}/query`, {page_size: 2}).body;
  assert.equal(first.results.length, 2); assert.equal(first.has_more, true);
  assert.equal(call(fake, 'POST', `databases/${db.id}/query`, {page_size: 2, start_cursor: first.next_cursor}).body.results.length, 1);
  assert.equal(call(fake, 'POST', `databases/${db.id}/query`, {filter: {property: 'Stage', select: {does_not_exist: 'x'}}}).status, 400, 'an unknown filter is said, not ignored');
});

test('an archived page leaves queries and cannot be edited, as in Notion', () => {
  const fake = createNotionFake();
  const db = call(fake, 'POST', 'databases', {parent: {page_id: fake.root.id}, title: text('T'), properties: {Name: {title: {}}}}).body;
  const row = call(fake, 'POST', 'pages', {parent: {database_id: db.id}, properties: {Name: {title: text('a')}}}).body;
  assert.equal(call(fake, 'PATCH', `pages/${row.id}`, {archived: true}).status, 200);
  assert.equal(call(fake, 'POST', `databases/${db.id}/query`, {}).body.results.length, 0);
  const again = call(fake, 'PATCH', `pages/${row.id}`, {archived: true});
  assert.equal(again.status, 400); assert.match(again.body.message, /Can't edit block that is archived/);
});

test('page bodies: append, insert after a block, read in pages, delete one block; search finds pages and databases', () => {
  const fake = createNotionFake();
  const pageId = call(fake, 'POST', 'pages', {parent: {page_id: fake.root.id}, properties: {title: {title: text('⚙️ Search settings')}},
    children: [{type: 'heading_3', heading_3: {rich_text: text('Roles to look for')}}, {type: 'bulleted_list_item', bulleted_list_item: {rich_text: text('sre')}}]}).body.id;
  const [heading] = call(fake, 'GET', `blocks/${pageId}/children`).body.results;
  call(fake, 'PATCH', `blocks/${pageId}/children`, {after: heading.id, children: [{type: 'bulleted_list_item', bulleted_list_item: {rich_text: text('devops')}}]});
  let blocks = call(fake, 'GET', `blocks/${pageId}/children`).body.results;
  assert.deepEqual(blocks.map(block => block[block.type].rich_text[0].plain_text), ['Roles to look for', 'devops', 'sre']);
  call(fake, 'DELETE', `blocks/${blocks[2].id}`);
  blocks = call(fake, 'GET', `blocks/${pageId}/children`).body.results;
  assert.equal(blocks.length, 2);
  assert.equal(call(fake, 'POST', 'search', {query: 'search settings', filter: {property: 'object', value: 'page'}}).body.results[0].id, pageId);
  assert.equal(call(fake, 'GET', 'users/me').status, 200);
  assert.equal(call(fake, 'GET', 'comments').status, 400, 'a request the stand-in does not know is said, never answered with made-up data');
});

test('a scenario is plain data, loaded in one call', () => {
  const fake = createNotionFake();
  const ids = fake.seed({databases: [{title: 'Job Tracker', properties: {Job: {title: {}}, Stage: {select: {}}},
    rows: Array.from({length: 200}, (_, i) => ({Job: {title: text(`Job ${i}`)}, Stage: {select: {name: i % 2 ? 'Applied' : 'Saved'}}}))}]});
  const all = [];
  for (let cursor; ;) { const out = call(fake, 'POST', `databases/${ids['Job Tracker']}/query`, {start_cursor: cursor}).body; all.push(...out.results); if (!out.has_more) break; cursor = out.next_cursor; }
  assert.equal(all.length, 200);
});
