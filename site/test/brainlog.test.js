// The product brain's log (src/brainlog.js): POST /api/brain/log with the scripts' key writes D1 brain_messages; a tap is logged by
// src/brain.js; /admin/brain lists every message newest first, with the decision's status now, a filter and the full text.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {log, messages, page, view} from '../src/brainlog.js';
import {brain} from '../src/brain.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0030_brain_messages.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const id = 'ab12'.repeat(8), dashed = `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
const env = () => ({STATS: d1(), STATS_KEY: 'k', STATS_API_KEY: 'api'});
const post = (e, body, key = 'api') => log(new Request('https://x/api/brain/log', {method: 'POST', headers: {Authorization: `Bearer ${key}`},
  body: JSON.stringify(body)}), e);
const all = e => e.STATS.db.prepare('SELECT * FROM brain_messages ORDER BY id').all();

test('a message with the key is stored; the Notion id loses its dashes; without the key nothing is', async () => {
  const e = env();
  assert.equal((await post(e, {decision: dashed, kind: 'recommendation', title: 'Ship the brain page', text: 'Why now: …', status: 'Proposed',
    notion_url: 'https://www.notion.so/abc', telegram_id: 812, at: '2026-10-07T05:01:00Z'})).status, 200);
  assert.equal((await post(e, {decision: id, kind: 'plan', title: 'x'}, 'wrong')).status, 404);
  const [row] = all(e);
  assert.deepEqual({decision: row.decision, kind: row.kind, status: row.status, telegram_id: row.telegram_id, source: row.source, at: row.at},
    {decision: id, kind: 'recommendation', status: 'Proposed', telegram_id: 812, source: 'brain', at: '2026-10-07T05:01:00.000Z'});
  assert.equal(all(e).length, 1);
});

test('a bad row is refused, a repeat (a re-run sync) is ignored, an unknown status is kept blank, a foreign link dropped', async () => {
  const e = env();
  assert.equal((await post(e, {decision: 'nope', kind: 'plan'})).status, 400);
  assert.equal((await post(e, {decision: id, kind: 'gossip'})).status, 400);
  const twice = {decision: id, kind: 'status', status: 'Approved', at: '2026-10-07T06:00:00Z', notion_url: 'https://evil.example/x'};
  const answer = await (await post(e, {messages: [twice, twice, {decision: id, kind: 'status', status: 'Maybe', at: '2026-10-07T07:00:00Z'}]})).json();
  assert.deepEqual(answer, {saved: 3, refused: 0});
  assert.deepEqual(all(e).map(r => [r.status, r.notion_url]), [['Approved', ''], ['', '']]);
});

test('a re-run sync adds nothing the log already has, even at another time', async () => {
  const e = env();
  await post(e, {decision: id, kind: 'status', status: 'Approved', at: '2026-10-07T06:00:00Z'});
  await post(e, {messages: [{decision: id, kind: 'status', status: 'Approved', at: '2026-10-07T09:30:00Z', source: 'backfill'},
    {decision: id, kind: 'recommendation', status: 'Proposed', title: 'New one', at: '2026-10-05T05:00:00Z', source: 'backfill'}]});
  await post(e, {decision: id, kind: 'recommendation', status: 'Proposed', title: 'New one', at: '2026-10-05T05:00:01Z', source: 'backfill'});
  assert.deepEqual(all(e).map(r => [r.kind, r.source]), [['status', 'brain'], ['recommendation', 'backfill']]);
});

test('a tap is logged with the status it leads to and the Telegram message id; a failed tap is logged as failed', async () => {
  const e = {...env(), BRAIN_BOT_TOKEN: 't', BRAIN_WEBHOOK_SECRET: 's', BRAIN_CHAT_ID: '42'};
  const tap = data => new Request('https://x/api/brain/telegram', {method: 'POST', headers: {'X-Telegram-Bot-Api-Secret-Token': 's'},
    body: JSON.stringify({callback_query: {id: 'q', data, message: {chat: {id: 42}, message_id: 77}}})});
  const fetcher = async () => new Response('{}');
  await brain(tap(`pb:x:${id}`), e, async () => {}, fetcher);
  await brain(tap(`pb:ok:${id}`), e, async () => { throw new Error('GitHub dispatch failed: 403'); }, fetcher);
  const rows = all(e);
  assert.deepEqual(rows.map(r => [r.kind, r.status, r.telegram_id, r.source]), [['tap', 'Exploring', 77, 'tap'], ['tap', '', 77, 'tap']]);
  assert.match(rows[0].title, /Exploring/);
  assert.match(rows[1].body, /403/);
});

test('a tap still answers when the log write fails', async () => {
  const sent = [];
  const e = {STATS: {prepare() { throw new Error('D1 down'); }}, BRAIN_BOT_TOKEN: 't', BRAIN_WEBHOOK_SECRET: 's', BRAIN_CHAT_ID: '42'};
  const request = new Request('https://x/api/brain/telegram', {method: 'POST', headers: {'X-Telegram-Bot-Api-Secret-Token': 's'},
    body: JSON.stringify({callback_query: {id: 'q', data: `pb:n:${id}`, message: {chat: {id: 42}, message_id: 1}}})});
  await brain(request, e, async () => {}, async (url, init) => { sent.push(url.split('/').pop()); return new Response('{}'); });
  assert.deepEqual(sent, ['editMessageReplyMarkup', 'answerCallbackQuery']);
});

async function seeded() {
  const e = env(), other = 'cd34'.repeat(8);
  await post(e, {messages: [
    {decision: id, kind: 'recommendation', title: 'Ship the brain page', text: 'Evidence: <b>12</b> taps lost', status: 'Proposed', notion_url: 'https://www.notion.so/one', at: '2026-10-05T05:00:00Z'},
    {decision: id, kind: 'tap', title: 'Tapped ✅ Exploring…', status: 'Exploring', at: '2026-10-05T06:00:00Z', source: 'tap'},
    {decision: id, kind: 'plan', title: 'Plan', text: '## Explored plan\n1. Table\n2. Page', status: 'Plan ready', at: '2026-10-05T06:10:00Z'},
    {decision: id, kind: 'status', status: 'Approved', at: '2026-10-05T07:00:00Z'},
    {decision: other, kind: 'recommendation', title: 'Post on Reddit', status: 'Proposed', notion_url: 'https://www.notion.so/two', at: '2026-10-06T05:00:00Z'},
    {decision: other, kind: 'status', status: 'Not now', at: '2026-10-06T08:00:00Z'}]});
  return e;
}

test('the list is newest first, each row with its decision\'s title, status now and Notion link', async () => {
  const rows = await messages((await seeded()).STATS);
  assert.deepEqual(rows.map(r => [r.kind, r.now]), [['status', 'Not now'], ['recommendation', 'Not now'], ['status', 'Approved'],
    ['plan', 'Approved'], ['tap', 'Approved'], ['recommendation', 'Approved']]);
  assert.equal(rows[2].decision_title, 'Ship the brain page');
  assert.equal(rows[2].link, 'https://www.notion.so/one');
});

test('the page: status pills with counts, the filter, the full text escaped in a toggle, a Notion link; empty states', async () => {
  const rows = await messages((await seeded()).STATS);
  const html = page(rows);
  assert.match(html, /🧠 Product Brain/);
  assert.match(html, /All · 2/);
  assert.match(html, /href="\/admin\/brain\?status=Approved">Approved · 1/);
  assert.match(html, /href="\/admin\/brain\?status=Not%20now">Not now · 1/);
  assert.match(html, /<details><summary>Full text<\/summary><div class="body">Evidence: &lt;b&gt;12&lt;\/b&gt; taps lost/);
  assert.match(html, /href="https:\/\/www.notion.so\/one" target="_blank"/);
  const approved = page(rows, 'Approved');
  assert.doesNotMatch(approved, /Post on Reddit/);
  assert.equal((approved.match(/class="msg"/g) || []).length, 4);
  assert.match(page(rows, 'Done'), /No decision has this status now/);
  assert.match(page([]), /No brain message logged yet/);
});

test('/admin/brain is the owner\'s only: a stranger gets 404, the owner the page, filtered by ?status=', async () => {
  const e = await seeded();
  assert.equal((await view(new Request('https://x/admin/brain'), e)).status, 404);
  const response = await view(new Request('https://x/admin/brain?status=Not%20now', {headers: {Authorization: 'Bearer api'}}), e);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Post on Reddit/);
  assert.doesNotMatch(html, /Ship the brain page/);
});
