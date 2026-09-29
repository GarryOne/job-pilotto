import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as notion from '../lib/notion.js';

const rich = text => [{plain_text: text}];
// A Profile page with a toggle and a table; `edited` is its last_edited_time.
function fakeNotion(state) {
  const routes = [];
  const fetcher = async (url, {method = 'GET'} = {}) => {
    const route = url.replace('https://api.notion.com/v1/', '').split('?')[0];
    routes.push(`${method} ${route}`);
    const json = value => ({ok: true, status: 200, json: async () => value});
    if (route === 'pages/profile') return json({last_edited_time: state.edited});
    if (route === 'blocks/profile/children') return json({results: [
      {id: 'h', type: 'heading_2', heading_2: {rich_text: rich('Contact')}},
      {id: 'tg', type: 'toggle', has_children: true, toggle: {rich_text: rich('Salary')}},
      {id: 'tb', type: 'table', has_children: true, table: {}}]});
    if (route === 'blocks/tg/children') return json({results: [{id: 'p', type: 'paragraph', paragraph: {rich_text: rich(state.salary)}}]});
    if (route === 'blocks/tb/children') return json({results: [{id: 'r', type: 'table_row', table_row: {cells: [rich('Email'), rich('ada@example.com')]}}]});
    if (method !== 'GET') return json({});
    throw new Error(`unexpected ${route}`);
  };
  return {fetcher, routes};
}
const ago = minutes => new Date(Date.now() - minutes * 60_000).toISOString();
const cache = {cache: true};

test('a kept page costs nothing when read again, one check once a write happened, a full read once it changed', async () => {
  notion._trees.reset();
  const state = {edited: ago(30), salary: 'CHF 150k'};
  const {fetcher, routes} = fakeNotion(state);
  assert.equal(await notion.pageText('t', 'profile', fetcher, cache), 'Contact\nSalary\nCHF 150k\nEmail | ada@example.com');
  const first = routes.length;
  assert.equal(first, 4);  // the check + the page + the toggle + the table
  await notion.textBlocks('t', 'profile', fetcher, cache);
  assert.equal(routes.length, first, 'read again at once: no request');

  await notion.call('t', 'PATCH', 'blocks/elsewhere/children', {children: []}, fetcher);  // the app wrote something
  await notion.pageText('t', 'profile', fetcher, cache);
  assert.deepEqual(routes.slice(first + 1), ['GET pages/profile'], 'after a write: only the check, the page is unchanged');

  state.edited = ago(10);
  state.salary = 'CHF 160k';
  await notion.call('t', 'PATCH', 'blocks/x', {}, fetcher);
  assert.match(await notion.pageText('t', 'profile', fetcher, cache), /CHF 160k/, 'changed in Notion: read again');
});

test('a page edited in the last 2 minutes is always read again (Notion rounds the edit time to the minute)', async () => {
  notion._trees.reset();
  const state = {edited: new Date().toISOString(), salary: 'a'};
  const {fetcher, routes} = fakeNotion(state);
  await notion.pageText('t', 'profile', fetcher, cache);
  state.salary = 'b';
  await notion.call('t', 'PATCH', 'blocks/x', {}, fetcher);
  assert.match(await notion.pageText('t', 'profile', fetcher, cache), /\nb\n/);
  assert.equal(routes.filter(route => route === 'GET blocks/profile/children').length, 2);
});

test('readers asking for the same page at once share one read', async () => {
  notion._trees.reset();
  const {fetcher, routes} = fakeNotion({edited: ago(30), salary: 'x'});
  await Promise.all([notion.pageText('t', 'profile', fetcher, cache), notion.textBlocks('t', 'profile', fetcher, cache),
    notion.pageText('t', 'profile', fetcher, cache)]);
  assert.equal(routes.length, 4);
});

test('the app and the Python engine take turns through the same pace file', async () => {
  const pace = await import('../lib/notion-pace.js');
  const path = await import('node:path');
  assert.equal(path.basename(pace.paceFile('abc')), 'job-pilotto-notion-ba7816bf8f01.pace');  // src/notion/pace.py
  const token = `test-${Date.now()}`;
  const first = await pace.claim(token), second = await pace.claim(token);
  assert.equal(second - first, pace.GAP_MS);
  await pace.calmUntil(token, Date.now() + 2000);
  assert.ok(await pace.claim(token) >= Date.now() + 1900);
  (await import('node:fs')).rmSync(pace.paceFile(token), {force: true});
});
