// Both hosts keep working: workers.dev (installed apps, never redirected) and the jobpilotto.top alias (bare name -> www). Guards src/hosts.js and wrangler.toml.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';
import worker from '../src/index.js';
import {apexRedirect, legacyPageRedirect, PAGE_PATHS} from '../src/hosts.js';

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
  const [a, b] = await Promise.all([worker.fetch(ask('www.jobpilotto.workers.dev', '/not-a-page'), env, {}), worker.fetch(ask('www.jobpilotto.top', '/not-a-page'), env, {})]);
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

test('jobadabra.top: bare name goes to www, www is served, wrangler attaches both', () => {
  const response = apexRedirect(ask('jobadabra.top', '/privacy?x=1'));
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('Location'), 'https://www.jobadabra.top/privacy?x=1');
  for (const path of API_PATHS) assert.equal(apexRedirect(ask('www.jobadabra.top', path)), null, path);
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /pattern = "www\.jobadabra\.top", custom_domain = true/);
  assert.match(toml, /pattern = "jobadabra\.top", custom_domain = true/);
});

test('old www.jobpilotto.top: pages go to www.jobadabra.top, API paths are served (installed apps)', () => {
  const r = legacyPageRedirect(ask('www.jobpilotto.top', '/compare?x=1'));
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('Location'), 'https://www.jobadabra.top/compare?x=1');
  assert.equal(legacyPageRedirect(ask('www.jobpilotto.top', '/index.html')).headers.get('Location'), 'https://www.jobadabra.top/');
  for (const path of ['/api/index', '/api/ai/x', '/report/telemetry', '/report/fill-failure', '/telemetry/version', '/install', '/admin', '/download/x'])
    assert.equal(legacyPageRedirect(ask('www.jobpilotto.top', path)), null, path);
  assert.equal(legacyPageRedirect(ask('www.jobpilotto.top', '/', {method: 'POST'})), null);
  for (const host of ['www.jobadabra.top', 'www.jobpilotto.workers.dev']) assert.equal(legacyPageRedirect(ask(host, '/compare')), null, host);
});

test('every page in public/ is redirected and listed in run_worker_first; a page added later fails here', () => {
  const pages = readdirSync(new URL('../public', import.meta.url)).filter((f) => f.endsWith('.html')).map((f) => '/' + f.replace(/\.html$/, '').replace(/^index$/, ''));
  assert.deepEqual([...PAGE_PATHS].sort(), pages.sort());
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  for (const path of PAGE_PATHS) assert.ok(toml.includes(`"${path}"`), `run_worker_first lacks ${path}`);
});

test('every host the site accepts keeps being served: none is dropped', async () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const hosts = ['www.jobadabra.top', 'jobadabra.top', 'www.jobpilotto.top', 'jobpilotto.top'];
  for (const host of hosts) assert.ok(toml.includes(`pattern = "${host}", custom_domain = true`), `${host} missing from wrangler.toml`);
  assert.match(toml, /^workers_dev = true$/m);
  const env = {ASSETS: {fetch: async () => new Response('page')}};
  for (const host of ['www.jobadabra.top', 'www.jobpilotto.top', 'www.jobpilotto.workers.dev']) {
    const response = await worker.fetch(ask(host, '/privacy.json'), env, {});
    assert.notEqual(response.status, 301, host);
  }
});
