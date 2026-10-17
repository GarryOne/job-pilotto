// The install's site token (lib/install-token.js): asked once and kept, one ask at a time, no ask after a 429 until the next UTC day, and the only
// place in the app that asks (17-18 Oct 2026: ~1 ask a second used up the day's tokens and hid the owner's Ready to send card).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {forgetToken, installToken} from '../lib/install-token.js';

const storageOf = (settings = {}) => ({settings: () => settings, saveSettings: patch => Object.assign(settings, patch)});
const site = (status = 200) => {
  const asks = [];
  const fetcher = async (url, options) => { asks.push(JSON.parse(options.body)); await new Promise(resolve => setTimeout(resolve, 5)); return {ok: status === 200, status, json: async () => (status === 200 ? {token: 'tok-1'} : {error: 'limit reached for today'})}; };
  return {asks, fetcher};
};

test('thirty asks at once make one request, and the token is kept for every later call and restart', async () => {
  const storage = storageOf(), {asks, fetcher} = site();
  const got = await Promise.all(Array.from({length: 30}, () => installToken(storage, 'install-1', 'ai', {base: 'https://site', fetcher})));
  assert.deepEqual(new Set(got), new Set(['tok-1']));
  assert.equal(asks.length, 1);
  assert.deepEqual(asks[0], {install: 'install-1', purpose: 'ai'});
  assert.equal(await installToken(storageOf(storage.settings()), 'install-1', 'ai', {base: 'https://site', fetcher}), 'tok-1');   // a restart: the same settings
  assert.equal(asks.length, 1);
  assert.equal(await installToken(storage, 'install-2', 'ai', {base: 'https://site', fetcher}), 'tok-1');   // another install id is asked for anew
  assert.equal(asks.length, 2);
});

test('after a 429 nothing is asked again until the next UTC day', async () => {
  const storage = storageOf(), {asks, fetcher} = site(429);
  let at = Date.parse('2026-10-17T23:20:00Z');
  const now = () => at;
  for (let i = 0; i < 50; i++) assert.equal(await installToken(storage, 'install-1', 'ai', {base: 'https://site', fetcher, now}), '');
  assert.equal(asks.length, 1, 'one refusal, then quiet');
  at = Date.parse('2026-10-18T00:00:01Z');
  await installToken(storage, 'install-1', 'ai', {base: 'https://site', fetcher, now});
  assert.equal(asks.length, 2, 'asked again the next day');
});

test('an offline ask is tried again on the next call; a refused kept token is forgotten and asked for once', async () => {
  const storage = storageOf();
  let calls = 0;
  const offline = async () => { calls++; throw new Error('offline'); };
  assert.equal(await installToken(storage, 'install-1', 'ai', {base: 'https://site', fetcher: offline}), '');
  assert.equal(await installToken(storage, 'install-1', 'ai', {base: 'https://site', fetcher: offline}), '');
  assert.equal(calls, 2);
  const {asks, fetcher} = site();
  await installToken(storage, 'install-1', 'report', {base: 'https://site', fetcher});
  forgetToken(storage, 'report');
  await installToken(storage, 'install-1', 'report', {base: 'https://site', fetcher});
  assert.equal(asks.length, 2);
});

test('tokens kept under the old names are used, so no install asks again after the update', async () => {
  const storage = storageOf({reportToken: {install: 'install-1', value: 'old-report'}, recipesToken: {install: 'install-1', value: 'old-recipes'}}), {asks, fetcher} = site();
  assert.equal(await installToken(storage, 'install-1', 'report', {base: 'https://site', fetcher}), 'old-report');
  assert.equal(await installToken(storage, 'install-1', 'recipes', {base: 'https://site', fetcher}), 'old-recipes');
  assert.equal(asks.length, 0);
});

test('the class: no other app file asks the site for an install token', () => {
  const lib = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib');
  const others = fs.readdirSync(lib).filter(file => file.endsWith('.js') && file !== 'install-token.js' && fs.readFileSync(path.join(lib, file), 'utf8').includes('/api/install-token'));
  assert.deepEqual(others, [], 'ask through lib/install-token.js (kept, single-flight, quiet after a 429)');
});
