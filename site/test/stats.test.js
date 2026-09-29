import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {device, sourceOf} from '../src/stats.js';

// A D1 stand-in on real SQLite, with the real migration.
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_stats.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}),
  });
  return {db, prepare: sql => statement(sql)};
}
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15';
const request = (path, {ip = '1.2.3.4', agent = MAC, ...init} = {}) => new Request(`https://www.jobpilotto.workers.dev${path}`,
  {...init, headers: {'CF-Connecting-IP': ip, 'User-Agent': agent, ...init.headers}});
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 'salt', ASSETS: {fetch: () => new Response('asset')}});

test('a Download click is counted and redirected to the GitHub release file', async () => {
  const e = env();
  const response = await worker.fetch(request('/download/mac?from=hero&page=/&src=linkedin.com'), e, {});
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), 'https://github.com/GarryOne/job-pilotto/releases/latest/download/Job-Pilotto-mac-arm64.dmg');
  const [row] = e.STATS.db.prepare('SELECT * FROM downloads').all();
  assert.equal(row.platform, 'mac');
  assert.equal(row.button, 'hero');
  assert.equal(row.source, 'linkedin.com');
  assert.equal(row.device, 'Mac');
  assert.match(row.visitor, /^[0-9a-f]{16}$/);
  assert.equal((await worker.fetch(request('/download/linux'), e, {})).status, 404);
});

test('bots are redirected but not counted; page views are', async () => {
  const e = env();
  await worker.fetch(request('/download/windows?from=faq', {agent: 'Googlebot/2.1'}), e, {});
  assert.equal(e.STATS.db.prepare('SELECT COUNT(*) AS n FROM downloads').get().n, 0);
  const hit = await worker.fetch(request('/api/hit', {method: 'POST', body: JSON.stringify({page: '/', source: 'google.com'})}), e, {});
  assert.equal(hit.status, 204);
  const [view] = e.STATS.db.prepare('SELECT * FROM visits').all();
  assert.equal(view.source, 'google.com');
  assert.equal(view.page, '/');
});

test('the same person on the same day is one visitor; another address is another', async () => {
  const e = env();
  for (const ip of ['1.1.1.1', '1.1.1.1', '2.2.2.2']) {
    await worker.fetch(request('/api/hit', {ip, method: 'POST', body: '{"page":"/"}'}), e, {});
  }
  await worker.fetch(request('/download/mac?from=header', {ip: '1.1.1.1'}), e, {});
  await worker.fetch(request('/download/mac?from=header', {ip: '1.1.1.1'}), e, {});
  const html = await (await worker.fetch(request('/stats', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.match(html, /Visitors<\/span><b>2<\/b><small class="muted">3 page views/);
  assert.match(html, /Downloaders<\/span><b>1<\/b><small class="muted">2 clicks/);
  assert.match(html, /Conversion<\/span><b>50%/);
  assert.match(html, /<span>header<\/span>/);
});

test('/stats needs the key, then keeps it in a cookie and out of the address bar', async () => {
  const e = env();
  assert.equal((await worker.fetch(request('/stats'), e, {})).status, 404);
  assert.equal((await worker.fetch(request('/stats?key=wrong'), e, {})).status, 404);
  const first = await worker.fetch(request('/stats?key=k3y&days=7'), e, {});
  assert.equal(first.status, 302);
  assert.equal(first.headers.get('Location'), '/stats?days=7');
  assert.match(first.headers.get('Set-Cookie'), /jp_stats=k3y; Path=\/;.*HttpOnly; Secure/);
  assert.equal((await worker.fetch(request('/stats', {headers: {Cookie: 'jp_stats=k3y'}}), {...e, STATS_KEY: ''}, {})).status, 404);
});

test('the waitlist shows on /stats, newest first', async () => {
  const e = {...env(), WAITLIST: {list: async () => ({keys: [
    {name: 'signup:old@example.com', metadata: {at: '2026-09-01T10:00:00Z', role: 'SRE'}},
    {name: 'signup:new@example.com', metadata: {at: '2026-09-20T10:00:00Z', role: '<b>Dev</b>'}}]})}};
  const html = await (await worker.fetch(request('/stats', {headers: {Cookie: 'jp_stats=k3y'}}), e, {})).text();
  assert.ok(html.indexOf('new@example.com') < html.indexOf('old@example.com'));
  assert.match(html, /&lt;b&gt;Dev/);
  assert.match(html, /Pro waitlist<\/span><b>2</);
});

test('device and source are read without keeping anything identifying', () => {
  assert.equal(device(MAC), 'Mac');
  assert.equal(device('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'iPhone');
  assert.equal(device('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Windows');
  assert.equal(sourceOf('https://www.linkedin.com/feed/', 'www.jobpilotto.workers.dev'), 'linkedin.com');
  assert.equal(sourceOf('https://www.jobpilotto.workers.dev/compare.html', 'www.jobpilotto.workers.dev'), 'direct');
  assert.equal(sourceOf('', 'x'), 'direct');
});
