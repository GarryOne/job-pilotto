// App reports (src/telemetry.js): stored scrubbed, grouped into problems across users, shown with the /stats key,
// and the daily run sends the top problems to triage.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {daily, describe} from '../src/telemetry.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0001_stats.sql', '0002_telemetry.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)})});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', ASSETS: {fetch: () => new Response('asset')}});
const send = (e, events) => worker.fetch(new Request('https://www.jobpilotto.workers.dev/report/telemetry',
  {method: 'POST', body: JSON.stringify({events})}), e, {});
const crash = (install, version = '0.4.1', line = 12) => ({kind: 'crash', install, version, platform: 'darwin', at: '2026-09-29T10:00:00Z',
  where: 'window', type: 'TypeError', message: `Cannot read properties of undefined (reading 'id') at row ${line}`,
  stack: `TypeError: x\n    at render (file:///Applications/Job Pilotto.app/Contents/Resources/app.asar/renderer/pages/jobs.js:${line}:5)`});

test('reports are stored, and the same problem from two users (other line numbers) is one problem', async () => {
  const e = env();
  assert.equal((await send(e, [crash('install-aaaa'), crash('install-bbbb', '0.4.2', 40)])).status, 200);
  assert.equal((await send(e, [{kind: 'run_failed', install: 'install-aaaa', version: '0.4.1', platform: 'darwin', job: 'src.ai.prep build',
    error: 'JSONDecodeError: Unterminated string at char 2594 for igor@gmail.com', cutOff: true}])).status, 200);
  const rows = e.STATS.db.prepare('SELECT fingerprint, summary, data FROM telemetry').all();
  assert.equal(new Set(rows.filter(r => r.summary.startsWith('TypeError')).map(r => r.fingerprint)).size, 1);
  assert.ok(!rows.some(r => r.data.includes('igor@gmail.com')));  // scrubbed again on the server
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.workers.dev/telemetry?days=7', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.match(html, /TypeError: Cannot read properties/);
  assert.match(html, /<td><b>2<\/b><\/td>/);  // two users
  assert.match(html, /src\.ai\.prep build: JSONDecodeError/);
});

test('without the key the page does not exist; junk is refused', async () => {
  const e = env();
  assert.equal((await worker.fetch(new Request('https://www.jobpilotto.workers.dev/telemetry'), e, {})).status, 404);
  assert.equal((await send(e, [{kind: 'nonsense', install: 'x'}])).status, 400);
});

test('the daily run sends the top problems of the day to triage', async () => {
  const e = env();
  await send(e, [crash('install-aaaa'), crash('install-bbbb')]);
  const sent = [];
  const today = new Date();
  e.STATS.db.prepare('UPDATE telemetry SET day = ?').run(today.toISOString().slice(0, 10));
  assert.equal(await daily(e, async (_env, inputs, workflow) => sent.push({inputs, workflow}), today), 1);
  assert.equal(sent[0].workflow, 'telemetry-triage.yml');
  assert.equal(JSON.parse(sent[0].inputs.problems)[0].users, 2);
});

test('fingerprints ignore numbers and ids but keep what differs', () => {
  const a = describe({kind: 'form_issue', site: 'boards.greenhouse.io', label: 'Salary expectation (CHF 120000)', reason: 'dropdown'});
  const b = describe({kind: 'form_issue', site: 'boards.greenhouse.io', label: 'Salary expectation (CHF 95000)', reason: 'dropdown'});
  const c = describe({kind: 'form_issue', site: 'jobs.lever.co', label: 'Salary expectation (CHF 95000)', reason: 'dropdown'});
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, c.key);
});

test('How it helped: each install\'s latest daily totals, summed', async () => {
  const e = env();
  const health = (install, at, applied, interviews) => ({kind: 'health', install, version: '0.4.1', platform: 'darwin', at, applied, interviews, offers: 0, formsFilled: 3});
  await send(e, [health('install-aaaa', '2026-09-28T08:00:00Z', 5, 0), health('install-aaaa', '2026-09-29T08:00:00Z', 7, 1), health('install-bbbb', '2026-09-29T09:00:00Z', 2, 1)]);
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.workers.dev/telemetry?days=7', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.match(html, /📨 Applications<\/span><b>9<\/b>/);   // 7 (latest of the first install) + 2
  assert.match(html, /🧑‍💻 Interviews<\/span><b>2<\/b>/);
  assert.match(html, /all 2 installs reporting/);
});

test('the key, given once on either page, opens both (the cookie is for the whole site)', async () => {
  const e = env();
  const first = await worker.fetch(new Request('https://www.jobpilotto.workers.dev/stats?key=k3y'), e, {});
  const cookie = first.headers.get('Set-Cookie');
  assert.match(cookie, /Path=\/;/);
  const later = await worker.fetch(new Request('https://www.jobpilotto.workers.dev/telemetry', {headers: {Cookie: cookie.split(';')[0]}}), e, {});
  assert.equal(later.status, 200);
});

test('an install whose report has no counts yet shows "–", not 0', async () => {
  const e = env();
  await send(e, [{kind: 'health', install: 'install-cccc', version: '0.4.0', platform: 'darwin', at: '2026-09-29T08:00:00Z', ai: true}]);
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.workers.dev/telemetry?days=7', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.match(html, /📨 Applications<\/span><b>–<\/b>/);
  assert.match(html, /No counts yet/);
});

test('/telemetry/version: per exact version, installs, health days, run counts and problem events (key as a header)', async () => {
  const e = env();
  const health = (install, version, at, runsOk, runsFailed) => ({kind: 'health', install, version, platform: 'darwin', at, runsOk, runsFailed});
  await send(e, [health('install-aaaa', '0.4.0-alpha.50', '2026-09-26T08:00:00Z', 4, 0), health('install-aaaa', '0.4.0-alpha.50', '2026-09-28T09:00:00Z', 3, 1),
    health('install-bbbb', '0.4.0-alpha.5', '2026-09-28T09:00:00Z', 10, 2), crash('install-bbbb', '0.4.0-alpha.5')]);
  e.STATS.db.prepare("UPDATE telemetry SET day = substr(at, 1, 10)").run();
  const url = 'https://www.jobpilotto.workers.dev/telemetry/version?v=0.4.0-alpha.50&compare=0.4.0-alpha.5';
  assert.equal((await worker.fetch(new Request(url), e, {})).status, 404);
  assert.equal((await worker.fetch(new Request(url, {headers: {Authorization: 'Bearer wrong'}}), e, {})).status, 404);
  const body = await (await worker.fetch(new Request(url, {headers: {Authorization: 'Bearer k3y'}}), e, {})).json();
  const canary = body.versions['0.4.0-alpha.50'], stable = body.versions['0.4.0-alpha.5'];
  assert.deepEqual([canary.installs, canary.healthInstalls, canary.healthDays], [1, 1, 2]);
  assert.deepEqual([canary.healthFirst, canary.healthLast], ['2026-09-26T08:00:00Z', '2026-09-28T09:00:00Z']);
  assert.deepEqual(canary.runs, {ok: 7, failed: 1, reports: 2});
  assert.equal(canary.events.crash, 0);  // alpha.5's crash isn't alpha.50's: exact match
  assert.deepEqual([stable.runs.ok, stable.runs.failed, stable.events.crash], [10, 2, 1]);
  const bad = await worker.fetch(new Request('https://www.jobpilotto.workers.dev/telemetry/version?v=x%27%3B', {headers: {Authorization: 'Bearer k3y'}}), e, {});
  assert.equal(bad.status, 400);
});
