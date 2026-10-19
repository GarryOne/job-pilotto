// The Worker answers every route in docs/site-routes.json (the public list of what the app, extension, engine and CI call), and the list names every route the Worker has.
// Safety net for moving site/ out of the public repo (docs/superpowers/specs/2026-10-19-site-private-repo.md): the list is read from the public repo, never the other way round.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker from '../src/index.js';

const manifest = JSON.parse(readFileSync(new URL('../../docs/site-routes.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const ORIGIN = 'https://www.jobpilotto.top';
const FALLTHROUGH = 'no-route-answered';   // the static-assets stand-in: a request no route took lands here

function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {prepare: sql => statement(sql)};
}
const env = () => ({STATS: d1(), STATS_KEY: 'browser-key', STATS_API_KEY: 'script-key', STATS_SALT: 's',
  WAITLIST: {get: async () => null, put: async () => {}, list: async () => ({keys: []})}, ASSETS: {fetch: () => new Response(FALLTHROUGH)}});

async function answered(path, method) {
  const request = new Request(`${ORIGIN}${path}`, {method, headers: {'User-Agent': 'Mozilla/5.0 (Macintosh)'}, ...(method === 'GET' ? {} : {body: '{}'})});
  try {
    const response = await worker.fetch(request, env(), {waitUntil() {}});
    return (await response.text()) !== FALLTHROUGH;
  } catch {
    return true;   // a handler that throws without its bindings still took the route
  }
}

test('the list is well formed: unique paths, a known kind, methods only where a route is method-bound', () => {
  const kinds = new Set(['app', 'ci', 'webhook', 'page', 'owner']);
  const paths = manifest.routes.map(route => route.path);
  assert.ok(paths.length > 60, `routes listed: ${paths.length}`);
  assert.equal(new Set(paths).size, paths.length);
  for (const route of manifest.routes) {
    assert.ok(kinds.has(route.kind), `${route.path}: kind ${route.kind}`);
    assert.ok(route.path.startsWith('/'), route.path);
    if (route.prefix) assert.ok(route.path.endsWith('/'), `${route.path}: a prefix ends with /`);
  }
});

test('every route in src/index.js is in the list (add a new one there, with its kind)', () => {
  const listed = new Set(manifest.routes.map(route => route.path));
  const routes = [...source.matchAll(/pathname === '(\/[^']*)'/g)].map(match => match[1]).filter(path => path !== '/');
  const prefixes = [...source.matchAll(/pathname\.startsWith\('(\/[^']*)'\)/g)].map(match => match[1]);
  assert.deepEqual([...routes, ...prefixes].filter(path => !listed.has(path)), []);
});

test('the Worker answers every listed route, with every method listed for it', async () => {
  const missing = [];
  for (const route of manifest.routes) {
    if (route.assetsFallback) continue;   // answers from the public file when its store is empty: the stand-in cannot tell it from a missing route
    const path = route.prefix ? `${route.path}x` : route.path;
    for (const method of route.methods || ['GET', 'POST']) {
      if (!await answered(path, method)) missing.push(`${method} ${route.path}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('a path nobody listed falls through to the assets (the check above can fail)', async () => {
  assert.equal(await answered('/api/no-such-route-here', 'GET'), false);
});
