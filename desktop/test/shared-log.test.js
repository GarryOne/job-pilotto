// "See what's sent" (Settings → Advanced) shows what the app sent to the service, exactly as it left (lib/shared-log.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {list, add} from '../lib/shared-log.js';
import {createReporter} from '../lib/recipes.js';
import {send} from '../lib/reports.js';
import {createStorage} from '../lib/storage.js';

const storage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-shared-')), {encrypt: v => v, decrypt: v => v});

test('the log keeps the last 20 requests, newest first, and never throws', () => {
  const s = storage();
  for (let i = 0; i < 25; i++) add(s, `request ${i}`, {n: i}, Date.UTC(2026, 9, 3, 0, 0, i));
  const items = list(s);
  assert.equal(items.length, 20);
  assert.deepEqual([items[0].what, items[0].sent, items[19].what], ['request 24', {n: 24}, 'request 5']);
  assert.deepEqual(list({readText: () => { throw new Error('disk'); }}), []);
  assert.doesNotThrow(() => add({readText: () => '', writeText: () => { throw new Error('disk'); }}, 'x', {}));
});

test('a very large request is cut, not dropped', () => {
  const s = storage();
  add(s, 'big', {text: 'x'.repeat(20000)});
  assert.equal(list(s)[0].sent.truncated, true);
});

test('the batched counts and a fill report are copied to the log after the service took them, and not before', async () => {
  const s = storage(), seen = [];
  const ok = async () => ({ok: true, status: 200, json: async () => ({})});
  const reporter = createReporter(s, {fetcher: async () => ({ok: false, status: 500}), base: 'https://site.test', setTimer: () => ({}), onSent: (what, body) => seen.push([what, body])});
  reporter.fill('ashby');
  await reporter.flush();
  assert.deepEqual(seen, []);   // refused: nothing was sent
  const again = createReporter(s, {fetcher: ok, base: 'https://site.test', setTimer: () => ({}), onSent: (what, body) => seen.push([what, body])});
  again.fill('ashby');
  again.proposal([{key: 'email', phrase: 'courriel'}]);
  await again.flush();
  assert.equal(seen[0][0], 'shared counts → /api/controls');
  // n: 2: the refused batch was kept on disk and the next reporter (a restart) sends it with the new fill (lib/recipes.js, 9 Oct 2026).
  assert.deepEqual([seen[0][1].exposure, seen[0][1].proposals], [[{board: 'ashby', n: 2}], [{key: 'email', phrase: 'courriel'}]]);
  const run = {url: 'https://jobs.ashbyhq.com/x/1', trace: [{label: 'Country', outcome: 'left', reason: 'dropdown clicked, but no option matched'}], debug: {version: '0.8.81', form: [{label: 'Country', type: 'select', options: ['CH']}]}};
  const reports = [];
  await send(s, run, ok, (what, body) => reports.push([what, body]));
  assert.equal(reports[0][0], 'fill report → /report/fill-failure');
  assert.equal(reports[0][1].site, 'jobs.ashbyhq.com');
});
