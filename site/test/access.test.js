// Invite links (src/access.js, src/auth.js): the super admin invites someone on /admin/access; the link gives that
// person the admin role: every admin page, nothing to manage, no API. Expiry and removal take effect on the next request.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const ORIGIN = 'https://www.jobpilotto.workers.dev';
const env = () => ({STATS: d1(), STATS_KEY: 'browser-key', STATS_API_KEY: 'script-key', STATS_SALT: 's', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})},
  ASSETS: {fetch: () => new Response('asset')}});
const get = (e, path, headers = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, {headers: {'User-Agent': 'Mozilla/5.0 (Macintosh)', ...headers}}), e, {});
const post = (e, fields, headers = {}) => worker.fetch(new Request(`${ORIGIN}/admin/access`, {method: 'POST', body: new URLSearchParams(fields),
  headers: {Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded', ...headers}}), e, {});
const SUPER = {Authorization: 'Bearer script-key'};
const cookie = response => (response.headers.get('Set-Cookie') || '').match(/jp_admin=[^;]+/)?.[0];

async function invited(e, name = 'Ana', days = '30') {
  const page = await (await post(e, {action: 'invite', name, days}, SUPER)).text();
  const link = page.match(/value="(https:\/\/[^"]+\/admin\/join\?t=[\w-]+)"/)[1];
  return {page, path: link.slice(ORIGIN.length)};
}

test('only the super admin sees and uses /admin/access', async () => {
  const e = env();
  assert.equal((await get(e, '/admin/access')).status, 404);
  const page = await get(e, '/admin/access', SUPER);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Invite someone/);
  assert.equal((await post(e, {action: 'invite', name: 'X', days: '7'}, {...SUPER, Origin: 'https://evil.example'})).status, 404);   // another site's form
});

test('an invite link gives the admin role: every page, the menu without Access, no access page, no API', async () => {
  const e = env();
  const {page, path} = await invited(e, 'Ana');
  assert.match(page, /Invite for Ana/);
  const opened = await get(e, path);
  assert.deepEqual([opened.status, opened.headers.get('Location')], [302, '/admin']);
  const session = cookie(opened);
  for (const p of ['/admin', '/admin/website', '/admin/app', '/admin/insights', '/admin/self-healing', '/admin/ai-cost', '/admin/form-filling', '/admin/feedback']) {
    const response = await get(e, p, {Cookie: session});
    assert.equal(response.status, 200, p);
    const html = await response.text();
    assert.ok(!html.includes('href="/admin/access"'), `${p}: no Access in an admin's menu`);
    assert.match(html, /Ana · admin/);
  }
  assert.equal((await get(e, '/admin/access', {Cookie: session})).status, 404);
  assert.equal((await post(e, {action: 'invite', name: 'Eve', days: '90'}, {Cookie: session})).status, 404);
  assert.equal((await get(e, '/api/lab', {Cookie: session})).status, 404);   // APIs stay the super admin's
  assert.equal((await get(e, path)).status, 302);   // reusable: a link preview must not spend it
  assert.equal((await get(e, path + 'x')).status, 404);   // an unknown link
  const logins = e.STATS.db.prepare('SELECT ok, person FROM admin_logins ORDER BY at').all().map(r => [r.ok, r.person]);
  assert.deepEqual(logins, [[1, 'Ana'], [1, 'Ana'], [0, 'unknown invite link']]);
});

test('removing someone or letting their access expire ends it at the next request; the super admin can set a new expiry', async () => {
  const e = env();
  const {path} = await invited(e, 'Bo', '7');
  const session = cookie(await get(e, path));
  const id = e.STATS.db.prepare("SELECT id FROM admin_people WHERE name = 'Bo'").get().id;
  e.STATS.db.prepare("UPDATE admin_people SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?").run(id);
  assert.equal((await get(e, '/admin', {Cookie: session})).status, 404);   // expired
  assert.equal((await post(e, {action: 'extend', id, days: '30'}, SUPER)).status, 303);
  assert.equal((await get(e, '/admin', {Cookie: session})).status, 200);   // back, with a new expiry
  assert.equal((await post(e, {action: 'revoke', id}, SUPER)).status, 303);
  assert.equal((await get(e, '/admin', {Cookie: session})).status, 404);   // removed
  assert.equal((await post(e, {action: 'extend', id, days: '90'}, SUPER)).status, 303);
  assert.equal((await get(e, '/admin', {Cookie: session})).status, 404);   // a removed person is not brought back by an expiry
  assert.match(await (await get(e, '/admin/access', SUPER)).text(), /Bo<\/b><\/td><td class="muted">Removed/);
});

test('the link is kept only as a hash, and a forged admin session is refused', async () => {
  const e = env();
  const {path} = await invited(e, 'Cy');
  const token = path.split('t=')[1];
  assert.ok(!JSON.stringify(e.STATS.db.prepare('SELECT * FROM admin_people').all()).includes(token));
  const id = e.STATS.db.prepare("SELECT id FROM admin_people WHERE name = 'Cy'").get().id;
  assert.equal((await get(e, '/admin', {Cookie: `jp_admin=v2.${Math.floor(Date.now() / 1000) + 9999}.${id}.forged-signature-forged-signature-forged-sig`})).status, 404);
});
