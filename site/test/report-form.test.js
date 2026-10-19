// /api/report-form (src/report-form.js): an encrypted report is stored as two opaque objects and a counts-only row; refused without the install's 'report' token, over 8 MB, or past 3 a day;
// only the sending install deletes it; only the owner lists and downloads. Without the bucket nothing breaks (503).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {ALL_BYTES_PER_DAY, ALL_REPORTS_PER_DAY, MAX_BYTES, reportForm} from '../src/report-form.js';
import {tokenFor} from '../src/guard.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0071_form_reports.sql', import.meta.url), 'utf8'));
  db.exec('CREATE TABLE revoked (who TEXT)');
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const bucket = () => { const kept = new Map(); return {kept, put: async (name, value) => { kept.set(name, value); }, delete: async name => { kept.delete(name); },
  get: async name => (kept.has(name) ? {body: kept.get(name), text: async () => String(kept.get(name))} : null)}; };
const env = (extra = {}) => ({STATS: d1(), REPORTS: bucket(), STATS_KEY: 'k', STATS_API_KEY: 'owner-key', STATS_SALT: 's', ...extra});
const WRAPPED = 'A'.repeat(344), INSTALL = 'install-aaaa-bbbb';
const upload = async (e, {fetcher, install = INSTALL, token, size = 1000, purpose = 'report', now = new Date('2026-10-15T10:00:00Z'), meta = {requests: 12, cause: 'stalled'}} = {}) => reportForm(
  new Request('https://x/api/report-form', {method: 'POST', headers: {'X-Install': install, Authorization: `Bearer ${token ?? await tokenFor(install, e, purpose)}`, 'X-Report-Key': WRAPPED, 'X-Report-Meta': JSON.stringify(meta)}, body: new Uint8Array(size).fill(7)}),
  e, '/api/report-form', now, fetcher);
const owner = (e, method, path, headers = {}) => reportForm(new Request(`https://x${path}`, {method, headers: {Authorization: 'Bearer owner-key', ...headers}}), e, path.split('?')[0]);

test('an encrypted report is stored as two objects and a counts-only row', async () => {
  const e = env(), answer = await upload(e), body = await answer.json();
  assert.equal(answer.status, 200); assert.equal(body.ok, true);
  assert.deepEqual([...e.REPORTS.kept.keys()].sort(), [`2026-10-15/${body.id}.bin`, `2026-10-15/${body.id}.k`]);
  const row = e.STATS.db.prepare('SELECT * FROM form_reports').get();
  assert.deepEqual({bytes: row.bytes, requests: row.requests, cause: row.cause, status: row.status}, {bytes: 1000, requests: 12, cause: 'stalled', status: 'new'});
  assert.ok(!Object.values(row).some(value => String(value).includes(INSTALL)), 'the row names the install only by its digest');
});

test('refused: no token, another purpose\'s token, no bucket, too large, a fourth in a day', async () => {
  const e = env();
  assert.equal((await upload(e, {token: 'nope'})).status, 401);
  assert.equal((await upload(e, {purpose: 'recipes'})).status, 401);
  assert.equal((await reportForm(new Request('https://x/api/report-form', {method: 'POST'}), {STATS: d1()}, '/api/report-form')).status, 503);
  assert.equal((await upload(e, {size: MAX_BYTES + 1})).status, 413);
  for (let i = 0; i < 3; i++) assert.equal((await upload(e)).status, 200);
  assert.equal((await upload(e)).status, 429);
  assert.equal((await upload(e, {install: 'install-cccc-dddd'})).status, 200, 'the limit is per install');
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM form_reports').get().n, 4);
});

test('only the sending install deletes a report; rows older than 30 days go with the next upload', async () => {
  const e = env(), {id} = await (await upload(e)).json();
  const withToken = async install => reportForm(new Request(`https://x/api/report-form/${id}`, {method: 'DELETE', headers: {'X-Install': install, Authorization: `Bearer ${await tokenFor(install, e, 'report')}`}}), e, `/api/report-form/${id}`);
  assert.equal((await withToken('install-cccc-dddd')).status, 404);
  assert.equal(e.REPORTS.kept.size, 2);
  assert.equal((await withToken(INSTALL)).status, 200);
  assert.equal(e.REPORTS.kept.size, 0); assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM form_reports').get().n, 0);
  await upload(e, {now: new Date('2026-08-01T00:00:00Z')});
  await upload(e, {now: new Date('2026-10-15T00:00:00Z')});
  assert.deepEqual(e.STATS.db.prepare('SELECT day FROM form_reports').all().map(row => row.day), ['2026-10-15']);
});

test('only the owner lists, downloads and marks reports', async () => {
  const e = env(), {id} = await (await upload(e)).json();
  assert.equal((await reportForm(new Request('https://x/api/report-form'), e, '/api/report-form')).status, 401);
  const list = await (await owner(e, 'GET', '/api/report-form')).json();
  assert.deepEqual(list.reports.map(report => report.id), [id]);
  const download = await owner(e, 'GET', `/api/report-form/${id}`);
  assert.equal(download.headers.get('X-Report-Key'), WRAPPED);
  assert.equal((await owner(e, 'POST', `/api/report-form/${id}?status=fetched`)).status, 200);
  assert.deepEqual((await (await owner(e, 'GET', '/api/report-form')).json()).reports, [], 'a fetched report is no longer waiting');
  assert.equal((await owner(e, 'GET', '/api/report-form/nope')).status, 404);
});

test('the day\'s total holds when every install id is new: 50 reports and 200 MB across all installs, one counter row a day', async () => {
  const e = env();
  for (let i = 0; i < ALL_REPORTS_PER_DAY; i++) assert.equal((await upload(e, {install: `install-${String(i).padStart(4, '0')}-abcd`, size: 10})).status, 200, `report ${i}`);
  const over = await upload(e, {install: 'install-fresh-0001', size: 10});
  assert.equal(over.status, 429); assert.equal((await over.json()).error, 'limit reached for today');
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM form_reports').get().n, ALL_REPORTS_PER_DAY, 'the refused one stored nothing');
  assert.equal(e.REPORTS.kept.size, ALL_REPORTS_PER_DAY * 2);
  assert.deepEqual(e.STATS.db.prepare('SELECT reports FROM form_report_days').all().map(row => row.reports), [ALL_REPORTS_PER_DAY], 'one counter row, not one per request');
  assert.equal((await upload(e, {install: 'install-tomorrow-1', size: 10, now: new Date('2026-10-16T00:00:00Z')})).status, 200, 'the next UTC day starts again');
  const bytes = env(), full = ALL_BYTES_PER_DAY / MAX_BYTES;
  for (let i = 0; i < full; i++) assert.equal((await upload(bytes, {install: `install-big-${String(i).padStart(4, '0')}`, size: MAX_BYTES})).status, 200, `big ${i}`);
  assert.equal((await upload(bytes, {install: 'install-big-extra', size: 1000})).status, 429, 'the byte cap holds with new install ids too');
});

const telegram = () => { const calls = []; return {calls, fetcher: async (url, init) => { calls.push({url, body: JSON.parse(init.body)}); return {ok: true}; }}; };
const tellEnv = () => env({BRAIN_BOT_TOKEN: 'bot-token', BRAIN_CHAT_ID: '42'});

test('each stored report sends the owner exactly one Telegram message: counts only, a link to /admin/reports', async () => {
  const e = tellEnv(), fake = telegram();
  assert.equal((await upload(e, {fetcher: fake.fetcher})).status, 200);
  assert.equal(fake.calls.length, 1);
  const {url, body} = fake.calls[0];
  assert.equal(url, 'https://api.telegram.org/botbot-token/sendMessage'); assert.equal(body.chat_id, '42');
  assert.match(body.text, /^📮 <b>A form was reported<\/b> · Stalled on the form · 12 page responses · install [0-9a-f]{8} · 10:00 UTC\n<a href="https:\/\/www\.jobadabra\.top\/admin\/reports">/);
  assert.ok(!body.text.includes(INSTALL), 'the install only by a short digest');
  assert.deepEqual(body.text.replace(/<[^>]*>/g, '').match(/https?:\/\/[^\s]*/g) || [], [], 'no URL in the visible text');
});

test('a failing or missing Telegram never fails the upload; the 11th report of a day sends one summary, then silence', async () => {
  const down = async () => { throw new Error('boom'); };
  assert.equal((await upload(tellEnv(), {fetcher: down})).status, 200);
  const none = telegram();
  assert.equal((await upload(env(), {fetcher: none.fetcher})).status, 200); assert.equal(none.calls.length, 0, 'no bot configured, no call');
  const e = tellEnv(), fake = telegram();
  for (let i = 0; i < 13; i++) assert.equal((await upload(e, {fetcher: fake.fetcher, install: `install-${String(i).padStart(4, '0')}-abcd`})).status, 200);
  assert.equal(fake.calls.length, 11);
  assert.match(fake.calls[10].body.text, /More forms were reported today/);
});
