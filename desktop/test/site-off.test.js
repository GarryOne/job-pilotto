// Runs that are not a real install (the live-test twin, CI, smoke tests, a development build) never ask the site: one switch (lib/recipes.js
// setSiteOff, set from the telemetry reason) covers every request the app makes for packs and tokens. A new site-calling entry point added
// without the switch fails here. 9 Oct 2026: 260 throwaway installs a day used half of Cloudflare KV's free writes.
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import * as aliases from '../lib/aliases.js';
import * as recipes from '../lib/recipes.js';

afterEach(() => recipes.setSiteOff(''));
const memory = files => ({files, readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }, settings: () => ({}), saveSettings() {}});
const counting = () => { const calls = []; return {calls, fetcher: async url => { calls.push(String(url)); throw new Error('must not be asked'); }}; };

test('with the switch off, no entry point reaches the site', async () => {
  recipes.setSiteOff('a live-test twin');
  const net = counting();
  assert.deepEqual(await aliases.lookup(memory({}), {fetcher: net.fetcher}), []);
  assert.deepEqual(await recipes.lookup(memory({}), ['abcdef12'], {fetcher: net.fetcher}), {});
  await assert.rejects(recipes.token(memory({}), net.fetcher, recipes.SITE), /not asked/);
  assert.deepEqual(net.calls, []);
});

test('with the switch off, a cached pack is still served (the twin clones the real folder)', async () => {
  recipes.setSiteOff('a live-test twin');
  const files = {'aliases-cache.json': JSON.stringify({at: 1, aliases: [{key: 'email', phrase: 'courriel'}]})};
  const net = counting();
  assert.deepEqual(await aliases.lookup(memory(files), {fetcher: net.fetcher, now: 1 + 99 * 3600 * 1000}), [{key: 'email', phrase: 'courriel'}]);
  assert.deepEqual(net.calls, []);
});

test('with the switch on (a real install), the site is asked as before', async () => {
  const net = counting();
  await aliases.lookup(memory({}), {fetcher: net.fetcher});
  assert.ok(net.calls.length > 0);
});
