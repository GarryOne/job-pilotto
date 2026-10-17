// The three form-filling admin pages (owner, 14 Oct 2026): Real Form Filling and Lab Form Filling side by side in Form filling, with Benchmark and Learning; the old addresses only redirect.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';
import {PAGES} from '../src/admin.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'k3y', STATS_SALT: 'salt', WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})},
  ASSETS: {fetch: () => new Response('asset')}, fetcher: async () => new Response('', {status: 503})});
const owner = {headers: {Cookie: 'jp_stats=k3y'}};
const get = (e, path, init = {}) => worker.fetch(new Request(`https://www.jobpilotto.top${path}`, init), e, {});

test('each page is in its menu group under its name, and Real and Lab sit side by side', () => {
  const by = path => PAGES.find(page => page.path === path);
  assert.deepEqual([by('/admin/real-form-filling')?.name, by('/admin/real-form-filling')?.group], ['Real users', 'Form filling']);
  assert.deepEqual([by('/admin/lab-form-filling')?.name, by('/admin/lab-form-filling')?.group], ['Lab', 'Form filling']);
  assert.deepEqual([by('/admin/form-learning')?.name, by('/admin/form-learning')?.group], ['Learning', 'Form filling']);
  const order = PAGES.map(page => page.path);
  assert.equal(order.indexOf('/admin/lab-form-filling') - order.indexOf('/admin/real-form-filling'), 1);
});

test('each section lives on exactly the page the owner named, and Real and Lab link to each other', async () => {
  const e = env(), html = async path => (await get(e, path, owner)).text();
  const real = await html('/admin/real-form-filling'), learning = await html('/admin/form-learning'), lab = await html('/admin/lab-form-filling');
  const where = {'Top weaknesses': real, 'Real use: what the fill missed': real, 'Why fields were left empty': real, 'How applications ended': real, 'Efficiency, day by day': real, 'Required marks: seen vs counted': real,
    'Recipe funnel': learning, 'By AI family': learning, 'Proposed answers': learning};
  for (const [section, page] of Object.entries(where)) for (const other of [real, learning]) assert.equal(other.includes(section), other === page, `${section} on ${other === real ? 'Real' : 'Learning'}`);
  assert.ok(lab.includes('<h1>🛡️ Lab Form Filling</h1>'));
  assert.ok(real.includes('href="/admin/lab-form-filling">Lab Form Filling →'), 'Real links the Lab scorecard');
  assert.ok(lab.includes("href: '/admin/real-form-filling'"), 'Lab links Real back');
});

test('the old addresses redirect the owner to the new pages, the digest too, and anyone else gets a 404', async () => {
  const e = env();
  const moves = {'/admin/form-filling': '/admin/real-form-filling', '/smart-form-filling': '/admin/real-form-filling', '/admin/applying': '/admin/lab-form-filling',
    '/admin/form-filling/digest.md': '/admin/real-form-filling/digest.md', '/admin/form-filling/digest.json': '/admin/real-form-filling/digest.json'};
  for (const [old, now] of Object.entries(moves)) {
    assert.equal((await get(e, old)).status, 404, old);
    const moved = await get(e, `${old}?json`, owner);
    assert.deepEqual([moved.status, moved.headers.get('Location')], [301, `${now}?json`], old);
  }
  assert.equal((await get({...env(), STATS_API_KEY: 'api'}, '/admin/real-form-filling/digest.md', {headers: {Authorization: 'Bearer api'}})).status, 200);
  assert.notEqual((await get(e, '/applying/verify', {method: 'PUT', body: '{}'})).status, 301, 'API routes keep their paths');
});

// The class: no file links an old page path. The redirect list (src/admin.js) is the one place; migrations and the dated specs are history and are never rewritten.
test('no tracked file names an old page path except the redirect list', () => {
  const files = execFileSync('git', ['ls-files', '-z'], {cwd: new URL('../../', import.meta.url), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}).split('\0').filter(Boolean);
  const skip = file => file.startsWith('site/migrations/') || file.startsWith('docs/superpowers/') || file === 'site/src/admin.js' || file === 'site/test/form-pages.test.js' || /\.(png|jpe?g|gif|webp|ico|woff2?|zip|pdf)$/.test(file);
  const old = /\/admin\/(applying|form-filling)\b|\/smart-form-filling|admin\\\/(applying|form-filling)/;
  const hits = [];
  for (const file of files.filter(name => !skip(name))) {
    let text = '';
    try { text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'); } catch { continue; }
    if (old.test(text)) hits.push(file);
  }
  assert.deepEqual(hits, [], 'these files still link an old page path');
});
