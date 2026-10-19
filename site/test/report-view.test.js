// The owner's page /admin/reports (src/report-view.js): newest first, counts only, status waiting / fetched / expired, the day's totals, the Mac command; the owner's only (404 for anyone else).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {page, statusOf, view} from '../src/report-view.js';

const NOW = new Date('2026-10-19T12:00:00Z');
const ROWS = [
  {id: 'a', day: '2026-10-19', who: 'abcdef0123456789', bytes: 2048, requests: 12, cause: 'stalled', status: 'new'},
  {id: 'b', day: '2026-10-18', who: '99887766aabbccdd', bytes: 3 * 1048576, requests: 40, cause: 'wrong_page', status: 'fetched'},
  {id: 'd', day: '2026-10-19', who: 'ddeeff0011223344', bytes: 100, requests: 2, cause: 'person', status: 'new'},
  {id: 'c', day: '2026-09-01', who: '11223344aabbccdd', bytes: 500, requests: 3, cause: '', status: 'new'},
];

test('the page lists each report newest first with its status, size and the day\'s totals, and no host', () => {
  const html = page({rows: ROWS, today: {reports: 1, bytes: 2048}, now: NOW});
  assert.deepEqual([...html.matchAll(/<span class="st (\w+)">/g)].map(m => m[1]), ['waiting', 'fetched', 'waiting', 'expired']);
  assert.ok(html.indexOf('abcdef01') < html.indexOf('99887766'));
  assert.match(html, /1 \/ 50/); assert.match(html, /3\.0 MB/); assert.match(html, /reports-fetch\.mjs/);
  for (const words of ['Stalled on the form', 'Wrong page', 'No cause given', 'Reported by the person']) assert.ok(html.includes(words), words);
  assert.ok(!/wrong_page|>stalled</.test(html), 'no code words');
  assert.equal(statusOf(ROWS.at(-1), NOW), 'expired');
  assert.match(page({rows: [], today: null, now: NOW}), /No report yet/);
});

test('owner only: 404 without the key, the rows with it', async () => {
  const db = {prepare: sql => ({bind: () => ({all: async () => ({results: sql.includes('form_report_days') ? [{reports: 1, bytes: 2048}] : ROWS})})})};
  const env = {STATS: db, STATS_KEY: 'k', STATS_API_KEY: 'owner-key', STATS_SALT: 's'};
  assert.equal((await view(new Request('https://x/admin/reports'), env, NOW)).status, 404);
  const ok = await view(new Request('https://x/admin/reports', {headers: {Authorization: 'Bearer owner-key'}}), env, NOW);
  assert.equal(ok.status, 200); assert.match(await ok.text(), /abcdef01/);
});
