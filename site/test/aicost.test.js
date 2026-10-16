// What the AI costs us, per step and user (src/aicost.js), recorded on the relay (src/free-ai.js): money and counts only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {ACTIONS, record, report} from '../src/aicost.js';
import {freeAi} from '../src/free-ai.js';
import {tokenFor} from '../src/guard.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0015_ai_calls.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({bind: (...values) => statement(sql, values), run: async () => db.prepare(sql).run(...args),
    all: async () => ({results: db.prepare(sql).all(...args)}), first: async () => db.prepare(sql).get(...args)});
  return {db, prepare: sql => statement(sql)};
}
const kv = () => { const m = new Map(); return {m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }}; };
let usageNow = {};
const env = () => ({WAITLIST: kv(), STATS: d1(), STATS_SALT: 'salt', AI: {run: async () => ({choices: [{message: {content: 'private answer'}}], usage: {prompt_tokens: usageNow.input_tokens, completion_tokens: usageNow.output_tokens}})}});
const installKey = async id => `JPF1.${id}.${await tokenFor(id, {STATS_SALT: 'salt'}, 'ai')}`;
const now = new Date('2026-10-02T12:00:00Z');
const ask = (e, key, action, usage) => { usageNow = usage; return freeAi(new Request('https://x/api/ai/v1/messages', {method: 'POST', headers: {'x-api-key': key, ...(action ? {'x-jp-action': action} : {})},
  body: JSON.stringify({max_tokens: 10, messages: [{role: 'user', content: 'x'}]})}), e, now); };
const rows = e => e.STATS.db.prepare('SELECT * FROM ai_calls ORDER BY action').all().map(r => ({...r}));

test('each call through the relay is recorded under its step, with tokens and money, the holder only as a digest', async () => {
  const e = env(), key = await installKey('aaaa1111-install');
  await ask(e, key, 'score', {input_tokens: 2600, output_tokens: 433});
  await ask(e, key, 'score', {input_tokens: 2600, output_tokens: 433});
  await ask(e, key, 'kit', {input_tokens: 4000, output_tokens: 2000});
  await ask(e, key, 'made-up-step', {input_tokens: 10, output_tokens: 10});
  await ask(e, key, undefined, {input_tokens: 10, output_tokens: 10});
  const t = rows(e);
  assert.deepEqual(t.map(r => [r.action, r.calls]), [['kit', 1], ['other', 2], ['score', 2]]);   // unknown or missing steps are "other"
  const score = t.find(r => r.action === 'score');
  assert.deepEqual([score.tokens_in, score.tokens_out, score.cache_read], [5200, 866, 0]);
  assert.ok(score.micro_usd > 0 && /^[0-9a-f]{8}$/.test(score.who));
  assert.equal(JSON.stringify(t).includes('aaaa1111'), false, 'the install id is not kept');
  assert.equal(JSON.stringify(t).includes('private answer'), false, 'no answer text');
});

test('the report gives the cost per step, per user per active day and per month', async () => {
  const e = env();
  const day = n => new Date(Date.UTC(2026, 9, n, 12));
  for (const [id, d, calls] of [['u1', 1, 10], ['u1', 2, 10], ['u2', 2, 30]]) {
    for (let i = 0; i < calls; i++) await record(e, id, 'score', 'claude-sonnet-5-5', {input_tokens: 2600, output_tokens: 433}, 0.01, day(d));
  }
  await record(e, 'u1', 'kit', 'claude-sonnet-5-5', {input_tokens: 4000, output_tokens: 2000}, 0.04, day(2));
  const r = await report(e.STATS, 30, now);
  assert.equal(r.users, 2);
  assert.deepEqual(r.steps.map(s => [s.action, s.calls, Math.round(s.usd * 100) / 100]), [['score', 50, 0.5], ['kit', 1, 0.04]]);
  assert.ok(Math.abs(r.steps[0].perCall - 0.01) < 1e-9);
  assert.equal(r.activeUserDays, 3);                                    // u1 on 2 days, u2 on 1
  assert.ok(Math.abs(r.perUserDay.mean - 0.54 / 3) < 1e-9);
  assert.ok(Math.abs(r.perUserDay.max - 0.30) < 1e-9);
  assert.ok(Math.abs(r.monthPerActiveUser - 0.18 * 30) < 1e-6);
});

test('a failing log never breaks the relay, and the steps match the ones the app sends', async () => {
  const e = env(), key = await installKey('bbbb2222-install');
  e.STATS.db.exec('DROP TABLE ai_calls;');
  assert.equal((await ask(e, key, 'score', {input_tokens: 10, output_tokens: 10})).status, 200);
  assert.equal(await record({}, 'x', 'score', 'm', {}, 0.01), false);   // no database bound: nothing to do
  const python = readFileSync(new URL('../../src/ai/providers/anthropic_api.py', import.meta.url), 'utf8');
  const sent = /ACTIONS = \(([^)]*)\)/.exec(python)[1].match(/'([a-z_]+)'/g).map(word => word.replace(/'/g, ''));
  assert.deepEqual(sent, ACTIONS, 'src/ai/providers/anthropic_api.py ACTIONS and site/src/aicost.js ACTIONS must be the same list');
});
