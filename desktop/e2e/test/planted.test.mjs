// A failure planted on purpose marks itself where it is planted, so the app's Sentry reporter never sends what a test caused (16 Oct 2026: 98% of a month's Sentry quota
// was CI e2e). The class: every fake that serves a failure, plus the recall benchmark. A new fake that counts failures without marking them fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {startAiProxy} from '../lib/ai-proxy.mjs';
import {startGoogleFake} from '../lib/google-fake.mjs';
import {startNotionProxy} from '../lib/notion-proxy.mjs';
import {startTelegramFake} from '../lib/telegram-fake.mjs';
import {markPlanted} from '../lib/planted.mjs';
import {plantedRecently} from '../../lib/planted.js';

const LIB = path.dirname(new URL('../lib/planted.mjs', import.meta.url).pathname);

test('markPlanted writes a line the app reads, and does nothing without a file', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-planted-')), 'planted.log');
  assert.equal(markPlanted('x', {}), false);
  assert.equal(markPlanted('ai server-error', {JOB_PILOTTO_E2E_PLANTED_FILE: file}, 1000), true);
  const env = {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_PLANTED_FILE: file};
  assert.equal(plantedRecently(env, 1000 + 60_000), true);
  assert.equal(plantedRecently(env, 1000 + 200_000), false, 'an old plant does not hide a later, real error');
});

test('every fake that serves a failure marks it planted', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-planted-')), 'planted.log');
  process.env.JOB_PILOTTO_E2E_PLANTED_FILE = file;
  const lines = () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).length : 0);
  const ai = await startAiProxy(), notion = await startNotionProxy(), telegram = await startTelegramFake(), google = await startGoogleFake();
  try {
    const cases = [
      ['ai', async () => { ai.setMode('server-error'); await fetch(`${ai.url}/v1/messages`, {method: 'POST', body: '{}'}).then(r => r.text()); ai.setMode('pass'); }],
      ['notion', async () => { notion.fail('server-error'); await fetch(`${notion.url}/v1/users/me`).then(r => r.text()); notion.pass(); }],
      ['telegram', async () => { telegram.fail(Object.keys((await import('../lib/telegram-fake.mjs')).TELEGRAM_FAILURES)[0]); await fetch(`${telegram.url}/botx/sendMessage`, {method: 'POST', body: 'chat_id=1&text=a', headers: {'content-type': 'application/x-www-form-urlencoded'}}).then(r => r.text()); telegram.pass(); }],
      ['google', async () => { google.revoke(); await fetch(`${google.url}/oauth2.googleapis.com/token`, {method: 'POST'}).then(r => r.text()); google.pass(); }],
    ];
    for (const [name, serve] of cases) { const before = lines(); await serve(); assert.ok(lines() > before, `the ${name} fake served a failure and did not mark it planted`); }
  } finally { delete process.env.JOB_PILOTTO_E2E_PLANTED_FILE; await Promise.all([ai.close(), notion.close(), telegram.close(), google.close()]); }
});

test('a new fake or plant that counts failures cannot skip the mark', () => {
  for (const name of fs.readdirSync(LIB).filter(file => file.endsWith('.mjs'))) {
    const source = fs.readFileSync(path.join(LIB, name), 'utf8');
    if (!/\b(stats\.|control\.)failed\+\+/.test(source)) continue;
    assert.match(source, /markPlanted\(/, `${name} counts served failures (failed++) without markPlanted()`);
  }
  assert.match(fs.readFileSync(path.join(LIB, 'recall.mjs'), 'utf8'), /markPlanted\(/, 'the recall benchmark plants window errors and must mark them');
});
