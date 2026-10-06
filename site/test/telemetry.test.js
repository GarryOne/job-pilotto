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
  for (const file of ['0001_stats.sql', '0002_telemetry.sql', '0003_feedback.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
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
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.workers.dev/admin/app?days=7', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.match(html, /TypeError: Cannot read properties/);
  assert.match(html, /<td><b>2<\/b><\/td>/);  // two users
  assert.match(html, /src\.ai\.prep build: JSONDecodeError/);
});

test('without the key the page does not exist; junk is refused', async () => {
  const e = env();
  assert.equal((await worker.fetch(new Request('https://www.jobpilotto.workers.dev/admin/app'), e, {})).status, 404);
  assert.equal((await send(e, [{kind: 'nonsense', install: 'x'}])).status, 400);
});

test('a crash, a stuck run or a failed run goes to triage from the first install; noisy kinds wait for three installs or many times', async () => {
  const e = env();
  const today = new Date();
  const stamp = db => db.STATS.db.prepare('UPDATE telemetry SET day = ?').run(today.toISOString().slice(0, 10));
  const sent = [];
  const dispatch = async (_env, inputs, workflow) => sent.push({inputs, workflow});
  const form = (install, label = 'Salary expectation') => ({kind: 'form_issue', at: new Date().toISOString(), install, version: '0.4.1', platform: 'darwin', site: 'boards.greenhouse.io', label, reason: 'dropdown'});
  await send(e, [form('install-aaaa'), form('install-bbbb')]);
  stamp(e);
  assert.equal(await daily(e, dispatch, today), 0);   // a form issue from two installs: counted, not a ticket yet
  assert.equal(sent.length, 0);
  await send(e, [form('install-cccc')]);
  stamp(e);
  assert.equal(await daily(e, dispatch, today), 1);   // three installs
  assert.equal(sent[0].workflow, 'telemetry-triage.yml');
  assert.equal(JSON.parse(sent[0].inputs.problems)[0].users, 3);
  // one install failing very often counts too
  const solo = env();
  await send(solo, Array.from({length: 20}, (_, i) => form('install-dddd', `Question ${i % 1}`)));
  stamp(solo);
  assert.equal(await daily(solo, dispatch, today), 1);
  // a single crash, and a single run the app had to stop, are enough: with a handful of users nothing else would reach an issue
  const first = env();
  await send(first, [crash('install-eeee'), {kind: 'run_failed', at: new Date().toISOString(), install: 'install-eeee', version: '0.4.1', platform: 'darwin', job: 'src daily', code: 124, error: 'stopped by the app: no output for 16 min'}]);
  stamp(first);
  assert.equal(await daily(first, dispatch, today), 2);
  // a run that ended with warnings has to repeat (3 times) before it is a ticket
  const warned = env();
  const warning = install => ({kind: 'run_warning', at: new Date().toISOString(), install, version: '0.4.1', platform: 'darwin', job: 'src daily run', warning: 'AI limit reached', seconds: 60});
  await send(warned, [warning('install-ffff'), warning('install-ffff')]);
  stamp(warned);
  assert.equal(await daily(warned, dispatch, today), 0);
  await send(warned, [warning('install-ffff')]);
  stamp(warned);
  assert.equal(await daily(warned, dispatch, today), 1);
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
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.workers.dev/admin/app?days=7', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.match(html, /📨 Applications<\/span><b>9<\/b>/);   // 7 (latest of the first install) + 2
  assert.match(html, /🧑‍💻 Interviews<\/span><b>2<\/b>/);
  assert.match(html, /all 2 installs reporting/);
});

test('the key, given once on either page, opens both (the cookie is for the whole site)', async () => {
  const e = env();
  const first = await worker.fetch(new Request('https://www.jobpilotto.workers.dev/admin/website?key=k3y'), e, {});
  const cookie = first.headers.get('Set-Cookie');
  assert.match(cookie, /Path=\/;/);
  const later = await worker.fetch(new Request('https://www.jobpilotto.workers.dev/admin/app', {headers: {Cookie: cookie.split(';')[0]}}), e, {});
  assert.equal(later.status, 200);
});

test('an install whose report has no counts yet shows "–", not 0', async () => {
  const e = env();
  await send(e, [{kind: 'health', install: 'install-cccc', version: '0.4.0', platform: 'darwin', at: '2026-09-29T08:00:00Z', ai: true}]);
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.workers.dev/admin/app?days=7', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.match(html, /📨 Applications<\/span><b>–<\/b>/);
  assert.match(html, /No counts yet/);
});

test('/telemetry/version: per exact version, installs, health days, run counts and problem events (key as a header)', async () => {
  const e = env();
  const health = (install, version, at, runsOk, runsFailed) => ({kind: 'health', install, version, platform: 'darwin', at, runsOk, runsFailed});
  await send(e, [health('install-aaaa', '0.5.50', '2026-09-26T08:00:00Z', 4, 0), health('install-aaaa', '0.5.50', '2026-09-28T09:00:00Z', 3, 1),
    health('install-bbbb', '0.5.5', '2026-09-28T09:00:00Z', 10, 2), crash('install-bbbb', '0.5.5')]);
  e.STATS.db.prepare("UPDATE telemetry SET day = substr(at, 1, 10)").run();
  const url = 'https://www.jobpilotto.workers.dev/telemetry/version?v=0.5.50&compare=0.5.5';
  assert.equal((await worker.fetch(new Request(url), e, {})).status, 404);
  assert.equal((await worker.fetch(new Request(url, {headers: {Authorization: 'Bearer wrong'}}), e, {})).status, 404);
  const body = await (await worker.fetch(new Request(url, {headers: {Authorization: 'Bearer k3y'}}), e, {})).json();
  const canary = body.versions['0.5.50'], stable = body.versions['0.5.5'];
  assert.deepEqual([canary.installs, canary.healthInstalls, canary.healthDays], [1, 1, 2]);
  assert.deepEqual([canary.healthFirst, canary.healthLast], ['2026-09-26T08:00:00Z', '2026-09-28T09:00:00Z']);
  assert.deepEqual(canary.runs, {ok: 7, failed: 1, reports: 2});
  assert.equal(canary.events.crash, 0);  // 0.5.5's crash isn't 0.5.50's: exact match
  assert.deepEqual([stable.runs.ok, stable.runs.failed, stable.events.crash], [10, 2, 1]);
  const bad = await worker.fetch(new Request('https://www.jobpilotto.workers.dev/telemetry/version?v=x%27%3B', {headers: {Authorization: 'Bearer k3y'}}), e, {});
  assert.equal(bad.status, 400);
});

test('the private page lists feedback with its contact; without the key it is not found', async () => {
  const e = env();
  e.STATS.db.prepare('INSERT INTO feedback (at, day, install, version, platform, text, contact) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), new Date().toISOString().slice(0, 10), 'install-aaaa', '0.5.75', 'darwin', 'Setup took 20 <min>', 'ana@example.com');
  const open = await worker.fetch(new Request('https://www.jobpilotto.workers.dev/admin/app', {headers: {Authorization: 'Bearer k3y'}}), e, {});
  const html = await open.text();
  assert.match(html, /💬 Feedback, newest first/);
  assert.match(html, /Setup took 20 &lt;min&gt;/);
  assert.match(html, /ana@example\.com/);
  const closed = await worker.fetch(new Request('https://www.jobpilotto.workers.dev/admin/app'), e, {});
  assert.equal(closed.status, 404);
});

test('setup funnel: furthest step per install, never counted as a problem', async () => {
  const e = env();
  const at = new Date().toISOString();
  // 'goals' below: an older app's step (now part of cv), ignored by the funnel.
  const step = (install, s, extra = {}) => ({kind: 'setup', install, version: '0.5.76', platform: 'darwin', at, step: s, ...extra});
  await send(e, [step('install-aaaa', 'welcome'), step('install-aaaa', 'ai'), step('install-aaaa', 'notion'),
    step('install-bbbb', 'welcome'), step('install-bbbb', 'ai', {ai: 'trial'}), step('install-bbbb', 'notion'), step('install-bbbb', 'cv'),
    step('install-bbbb', 'goals'), step('install-bbbb', 'draft'), step('install-bbbb', 'extras'), step('install-bbbb', 'done', {minutes: 12})]);
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.workers.dev/admin/app', {headers: {Authorization: 'Bearer k3y'}}), e, {})).text();
  assert.match(html, /🚦 Setup funnel/);
  assert.match(html, /median time to finish: 12 min/);
  assert.match(html, /1 used the free AI credit/);
  assert.match(html, /No problems reported/);  // setup steps are not problems
  const {funnel} = await import('../src/telemetry.js');
  const f = await funnel(e.STATS, 30);
  assert.deepEqual(f.reached.map(r => r.n), [2, 2, 2, 1, 1, 1, 1]);
});

test('why they stopped: reasons per step on the funnel', async () => {
  const e = env();
  const at = new Date().toISOString();
  const stop = (install, step, reason) => ({kind: 'setup', install, version: '0.5.82', platform: 'darwin', at, step: 'stopped', where: step, reason});
  await send(e, [stop('install-aaaa', 'notion', 'notion'), stop('install-bbbb', 'notion', 'notion'), stop('install-cccc', 'notion', 'privacy')]);
  const {funnel} = await import('../src/telemetry.js');
  assert.deepEqual((await funnel(e.STATS, 30)).stopped, {notion: {notion: 2, privacy: 1}});
});

test('a control report reads as one problem per fingerprint, outcome and reason, across users and sites', () => {
  const a = describe({kind: 'control', control: 'toggle-group', fp: '1d2pcapx18', outcome: 'failed', why: 'the option did not stay selected', site: 'h:aaaaaaaaaa'});
  const b = describe({kind: 'control', control: 'toggle-group', fp: '1d2pcapx18', outcome: 'failed', why: 'the option did not stay selected', site: 'jobs.ashbyhq.com'});
  const c = describe({kind: 'control', control: 'toggle-group', fp: '1d2pcapx18', outcome: 'missed', why: '', site: 'h:aaaaaaaaaa'});
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, c.key);
  assert.match(a.summary, /toggle-group 1d2pcapx18: failed/);
});

test('the owner\'s page shows the access guard: what hit a limit or a decoy, only as digests', async () => {
  const e = env();
  e.STATS.db.exec(readFileSync(new URL('../migrations/0008_guard.sql', import.meta.url), 'utf8'));
  const page = async () => (await worker.fetch(new Request('https://www.jobpilotto.workers.dev/admin/app', {headers: {Authorization: 'Bearer k3y'}}), e, {})).text();
  assert.match(await page(), /Access guard[\s\S]*Nothing odd/);
  const day = new Date().toISOString().slice(0, 10);
  e.STATS.db.prepare("INSERT INTO anomalies (day, kind, who, n, detail) VALUES (?, 'honeypot', 'abcdef0123456789', 2, 'x')").run(day);
  e.STATS.db.prepare("INSERT INTO revoked (who, reason, created_at) VALUES ('abcdef0123456789', 'asked for a honeypot', ?)").run(new Date().toISOString());
  const html = await page();
  assert.match(html, /honeypot<\/td><td><code>abcdef0123456789<\/code><\/td><td>2/);
  assert.match(html, /Revoked: <code>abcdef0123456789<\/code> \(asked for a honeypot\)/);
});

test('Machines reporting counts each install once, however many versions it ran', async () => {
  const e = env();
  const ev = (install, version, platform) => ({kind: 'health', install, version, platform, at: '2026-09-29T08:00:00Z'});
  await send(e, [ev('install-aaaa', '0.4.0', 'darwin'), ev('install-aaaa', '0.4.1', 'darwin'), ev('install-aaaa', '0.4.2', 'darwin'), ev('install-bbbb', '0.4.2', 'win32')]);
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.workers.dev/admin/app?days=30', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.match(html, /Machines reporting<\/span><b>2<\/b><small class="muted">2 ever seen · 1 (macOS|Windows), 1 (macOS|Windows)/);
});

test('Machines table: the version each install runs now, and the versions it has run', async () => {
  const e = env();
  const ev = (version, at) => ({kind: 'health', install: 'install-aaaa', version, platform: 'darwin', at});
  await send(e, [ev('0.4.0', '2026-09-28T08:00:00Z'), ev('0.4.2', '2026-09-30T08:00:00Z'), ev('0.4.1', '2026-09-29T08:00:00Z')]);
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.workers.dev/admin/app?days=30', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.match(html, /<span class="v now">0\.4\.2<\/span>/);
  assert.match(html, /<span class="v">0\.4\.0<\/span><span class="v">0\.4\.1<\/span><\/td>/);   // earlier versions only; the current one is the amber chip
});

test('Channels: machines, finished setup and active, by the channel each install reported', async () => {
  const e = env();
  const ev = (install, at, extra) => ({install, version: '0.4.2', platform: 'darwin', at, ...extra});
  await send(e, [
    ev('install-aaaa', '2026-09-29T08:00:00Z', {kind: 'health', source: 'reddit-devops'}), ev('install-aaaa', '2026-09-30T08:00:00Z', {kind: 'health', source: 'reddit-devops'}),
    ev('install-aaaa', '2026-09-29T08:05:00Z', {kind: 'setup', step: 'done', minutes: 6, source: 'reddit-devops'}),
    ev('install-bbbb', '2026-09-29T09:00:00Z', {kind: 'health', source: 'reddit-devops'}),
    ev('install-cccc', '2026-09-29T09:00:00Z', {kind: 'health'})]);
  e.STATS.db.exec('UPDATE telemetry SET day = substr(at, 1, 10)');   // the server stamps the day it received them; here, the day they happened
  const {channels} = await import('../src/telemetry.js');
  const rows = await channels(e.STATS, 30, new Date('2026-10-01T00:00:00Z'));
  assert.deepEqual(rows.map(r => [r.source, r.machines, r.done, r.active]), [['reddit-devops', 2, 1, 1], ['unknown', 1, 0, 0]]);
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.workers.dev/admin/app?days=30', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.match(html, /📣 Channels/);   // (the page reads the last 30 days from today, so only the heading is checked here)
});

test('Notion prompt: connect rate per reason, why not, and the revisit trigger; never a funnel step or a problem', async () => {
  const e = env();
  const at = new Date().toISOString();
  const gate = (install, extra) => ({kind: 'setup', install, version: '0.5.90', platform: 'darwin', at, step: 'notion_gate', where: 'dialog', minutes: 5, shown: 1, ...extra});
  await send(e, [gate('install-aaaa', {reason: 'save', outcome: 'connected'}),
    gate('install-bbbb', {reason: 'save', outcome: 'not_now', why: 'no_notion'}), gate('install-bbbb', {reason: 'prepare', outcome: 'closed'}),
    gate('install-bbbb', {reason: 'apply', outcome: 'closed'}),
    gate('install-cccc', {reason: 'focus', where: 'view', outcome: 'viewed'}),  // a locked page seen: not a refusal
    gate('install-dddd', {reason: 'save', outcome: 'failed'}), gate('install-dddd', {reason: 'save', outcome: 'connected'})]);
  const {gateStats, funnel} = await import('../src/telemetry.js');
  const g = await gateStats(e.STATS, 30);
  assert.equal(g.installs, 3);          // cccc only viewed a page
  assert.equal(g.connected, 2);          // aaaa, dddd
  assert.equal(g.never, 1);              // bbbb
  assert.equal(g.repeaters, 1);          // bbbb was asked 3 times
  assert.deepEqual(g.whys, {no_notion: 1});
  assert.equal(g.reasons.find(r => r.reason === 'save').connected, 2);
  assert.equal(g.reasons.find(r => r.reason === 'focus').viewed, 1);
  assert.equal(g.revisit, false);         // far below 30 installs
  assert.equal((await funnel(e.STATS, 30)).started, 0);  // these are not setup steps
  const html = await (await worker.fetch(new Request('https://www.jobpilotto.workers.dev/admin/app', {headers: {Authorization: 'Bearer k3y'}}), e, {})).text();
  assert.match(html, /🗂️ Notion prompt/);
  assert.match(html, /No problems reported/);
});

test('the revisit trigger needs 30 installs, over 40% never connecting and "I don\'t use Notion" on top', async () => {
  const e = env();
  const at = new Date().toISOString();
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const install = `install-${String(i).padStart(4, '0')}`;
    rows.push({kind: 'setup', install, version: '0.5.90', platform: 'darwin', at, step: 'notion_gate', reason: 'save', where: 'dialog', minutes: 3, shown: 1,
      ...(i < 15 ? {outcome: 'connected'} : {outcome: 'not_now', why: 'no_notion'})});
  }
  await send(e, rows);
  const {gateStats} = await import('../src/telemetry.js');
  const g = await gateStats(e.STATS, 30);
  assert.equal(g.installs, 30);
  assert.equal(g.neverRate, 0.5);
  assert.equal(g.revisit, true);
});

test('advice events are accepted and grouped by kind, place and act (7 Oct 2026)', async () => {
  const {describe} = await import('../src/telemetry.js');
  assert.deepEqual(describe({kind: 'advice', advice: 'role', where: 'strategy', act: 'taken'}),
    {key: 'advice|strategy|role|taken', summary: 'Advice role on strategy: taken'});
});
