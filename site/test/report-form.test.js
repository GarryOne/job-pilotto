// /api/report-form (src/report-form.js): an encrypted report is stored as two opaque objects and a counts-only row; refused without the install's 'report' token, over 8 MB, or past 3 a day;
// only the sending install deletes it; only the owner lists and downloads. Without the bucket nothing breaks (503).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {MAX_BYTES, reportForm} from '../src/report-form.js';
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
const upload = async (e, {install = INSTALL, token, size = 1000, purpose = 'report', now = new Date('2026-10-15T10:00:00Z'), meta = {requests: 12, cause: 'stalled'}} = {}) => reportForm(
  new Request('https://x/api/report-form', {method: 'POST', headers: {'X-Install': install, Authorization: `Bearer ${token ?? await tokenFor(install, e, purpose)}`, 'X-Report-Key': WRAPPED, 'X-Report-Meta': JSON.stringify(meta)}, body: new Uint8Array(size).fill(7)}),
  e, '/api/report-form', now);
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
