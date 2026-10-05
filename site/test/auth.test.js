// Who may open the owner's admin pages and APIs (src/auth.js): a signed session cookie that expires, a separate key for scripts,
// every ?key= login logged, and the old ways only until the scripts' key exists.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {SESSION_DAYS, isOwner, recentLogins, remember, same, sessionToken, validSession} from '../src/auth.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0024_admin_logins.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const req = (path, headers = {}) => new Request(`https://www.jobpilotto.workers.dev${path}`, {headers: {'User-Agent': 'Mozilla/5.0 (Macintosh)', 'CF-IPCountry': 'CH', ...headers}});
const now = Date.parse('2026-10-06T12:00:00Z');

test('a login swaps the key for a signed session that expires; the key itself never sits in a cookie', async () => {
  const env = {STATS_KEY: 'browser-key', STATS: d1()};
  const response = await remember(new URL('https://x/admin/app?key=browser-key&days=7'), env, req('/admin/app?key=browser-key'), now);
  assert.equal(response.headers.get('Location'), '/admin/app?days=7');
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.every(c => !c.includes('browser-key')));
  const session = cookies[0].match(/^jp_admin=([^;]+)/)[1];
  assert.equal(await isOwner(req('/admin', {Cookie: `jp_admin=${session}`}), env, now), true);
  assert.equal(await isOwner(req('/admin', {Cookie: `jp_admin=${session}`}), env, now + (SESSION_DAYS + 1) * 86400000), false);   // expired
  assert.equal(await isOwner(req('/admin', {Cookie: `jp_admin=${session}`}), {...env, STATS_KEY: 'rotated'}, now), false);   // a new key ends it
  assert.equal(await isOwner(req('/admin', {Cookie: `jp_admin=${session.slice(0, -2)}xx`}), env, now), false);   // tampered
  assert.equal(await validSession(env, `v1.${Math.floor(now / 1000) + 999999}.forged-signature-forged-signature-forged-sig`, now), false);
});

test('scripts use their own key once it exists; then the browser key no longer works as Bearer, nor the old raw-key cookie', async () => {
  const before = {STATS_KEY: 'browser-key'};
  assert.equal(await isOwner(req('/api/lab', {Authorization: 'Bearer browser-key'}), before), true);   // until the scripts move
  assert.equal(await isOwner(req('/admin', {Cookie: 'jp_stats=browser-key'}), before), true);
  const after = {STATS_KEY: 'browser-key', STATS_API_KEY: 'script-key'};
  assert.equal(await isOwner(req('/api/lab', {Authorization: 'Bearer script-key'}), after), true);
  assert.equal(await isOwner(req('/api/lab', {Authorization: 'Bearer browser-key'}), after), false);
  assert.equal(await isOwner(req('/admin', {Cookie: 'jp_stats=browser-key'}), after), false);
  assert.equal(await isOwner(req('/admin', {Authorization: 'Bearer wrong'}), after), false);
  assert.equal(await isOwner(req('/admin'), {}), false);   // no key configured: nobody
});

test('every ?key= login is logged, good and bad, with country and device and never the key', async () => {
  const env = {STATS_KEY: 'browser-key', STATS: d1()};
  assert.equal(await isOwner(req('/admin?key=guess'), env, now), false);
  assert.equal(await isOwner(req('/admin?key=browser-key'), env, now), true);
  await remember(new URL('https://x/admin?key=browser-key'), env, req('/admin?key=browser-key'), now + 1000);
  const logins = await recentLogins(env.STATS);
  assert.deepEqual(logins.map(row => [row.ok, row.country, row.device, row.path]), [[1, 'CH', 'Mac', '/admin'], [0, 'CH', 'Mac', '/admin']]);
  assert.ok(!JSON.stringify(logins).includes('key'));
});

test('keys are compared in constant time and never match an empty value', () => {
  assert.equal(same('abc', 'abc'), true);
  assert.equal(same('abc', 'abd'), false);
  assert.equal(same('', ''), false);
  assert.equal(same(undefined, undefined), false);
});

test('every call site awaits isOwner (a forgotten await is a truthy Promise: everyone would be let in)', () => {
  const dir = new URL('../src/', import.meta.url);
  for (const file of readdirSync(dir).filter(name => name.endsWith('.js'))) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    for (const line of source.split('\n').filter(l => /isOwner\(/.test(l) && !/export async function isOwner/.test(l))) {
      assert.match(line, /await isOwner\(/, `${file}: ${line.trim()}`);
    }
    assert.ok(!/\ballowed\(request/.test(source), `${file} still calls allowed()`);
  }
});

test('a session token is fresh for each login and carries its expiry', async () => {
  const token = await sessionToken({STATS_KEY: 'k'}, now);
  assert.match(token, new RegExp(`^v1\\.${Math.floor(now / 1000) + SESSION_DAYS * 86400}\\.[\\w-]{43}$`));
});
