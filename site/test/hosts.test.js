// Both hosts keep working: workers.dev (installed apps, never redirected) and the jobpilotto.top alias (bare name -> www). Guards src/hosts.js and wrangler.toml.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import worker from '../src/index.js';
import {apexRedirect} from '../src/hosts.js';

const ask = (host, path, init) => new Request(`https://${host}${path}`, init);
const API_PATHS = ['/api/index', '/api/notion/start?session=x', '/report/fill-failure', '/telemetry', '/admin', '/privacy', '/'];

test('the old host is never redirected, on any path: installed apps call it', () => {
  for (const path of API_PATHS) assert.equal(apexRedirect(ask('www.jobpilotto.workers.dev', path)), null, path);
});

test('the alias main address www.jobpilotto.top is served, not redirected', () => {
  for (const path of API_PATHS) assert.equal(apexRedirect(ask('www.jobpilotto.top', path)), null, path);
});

test('the bare alias domain goes to www, keeping path and query', () => {
  const response = apexRedirect(ask('jobpilotto.top', '/privacy?x=1'));
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('Location'), 'https://www.jobpilotto.top/privacy?x=1');
});

test('the worker answers the old host and the alias www the same way', async () => {
  const env = {ASSETS: {fetch: async () => new Response('page')}};
  const [a, b] = await Promise.all([worker.fetch(ask('www.jobpilotto.workers.dev', '/privacy'), env, {}), worker.fetch(ask('www.jobpilotto.top', '/privacy'), env, {})]);
  assert.equal(a.status, b.status);
  assert.equal(await a.text(), await b.text());
  assert.notEqual(a.status, 301);
});

test('wrangler.toml keeps workers.dev on and attaches the alias hosts as custom domains', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /^workers_dev = true$/m);
  assert.match(toml, /pattern = "www\.jobpilotto\.top", custom_domain = true/);
  assert.match(toml, /pattern = "jobpilotto\.top", custom_domain = true/);
});
