// Free AI on the app side (lib/ai-free.js): the install's own token becomes the Anthropic key, the SDKs follow our website, an own key leaves it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {apply, isFreeKey, migrate, start, stop, FREE_BASE} from '../lib/ai-free.js';

const storage = (settings = {}) => { let s = settings; const secrets = {};
  return {settings: () => s, saveSettings: p => { s = {...s, ...p}; }, setSecret: (n, v) => { secrets[n] = v; }, secret: n => secrets[n], secrets,
    readText: () => '', writeText: () => {}, dir: '/tmp/none'}; };
const site = (seen = []) => async (url, init) => { seen.push({url, body: JSON.parse(init.body)}); return Response.json({ok: true, token: 'tok123'}); };

test('start: no key or account; mints the install token, keeps JPF1.<install>.<token> and points the SDKs at the website', async () => {
  const env = {}, seen = [], st = storage();
  assert.deepEqual(await start(st, env, site(seen)), {ok: true});
  assert.equal(seen[0].url, 'https://www.jobpilotto.top/api/install-token');
  assert.equal(seen[0].body.purpose, 'ai');
  assert.match(st.secrets.ANTHROPIC_API_KEY, /^JPF1\..+\.tok123$/);
  assert.ok(isFreeKey(st.secrets.ANTHROPIC_API_KEY));
  assert.equal(env.ANTHROPIC_BASE_URL, FREE_BASE);
  assert.equal(st.settings().aiFree, true);
});

test('start fails in words when the website cannot be reached, and leaves the engine alone', async () => {
  const env = {}, st = storage({aiEngine: 'cli'});
  const result = await start(st, env, async () => { throw new Error('offline'); });
  assert.equal(result.ok, false); assert.match(result.error, /Free AI could not start/);
  assert.equal(st.settings().aiEngine, 'cli'); assert.equal(env.ANTHROPIC_BASE_URL, undefined);
});

test('start: Free is the Anthropic API engine, whatever engine was picked before', async () => {
  for (const before of ['cli', 'codex', 'openai', 'api', undefined]) {
    const st = storage({aiEngine: before});
    assert.deepEqual(await start(st, {}, site()), {ok: true});
    assert.equal(st.settings().aiEngine, 'api', `was ${before}`);
  }
});

test('an install that had the $1 credit moves to Free at start-up; one that did not is left alone', async () => {
  const old = storage({aiTrial: true, aiEngine: 'api'}); old.setSecret('ANTHROPIC_API_KEY', 'JP1.old.key');
  assert.deepEqual(await migrate(old, {}, site()), {ok: true, moved: true});
  assert.match(old.secrets.ANTHROPIC_API_KEY, /^JPF1\./); assert.equal(old.settings().aiTrial, false);
  const plain = storage({aiEngine: 'api'});
  assert.deepEqual(await migrate(plain, {}, site()), {ok: true, moved: false});
  assert.equal(plain.secrets.ANTHROPIC_API_KEY, undefined);
});

test('an install that still has only the old setting goes through Free AI at once (no gap before the move)', () => {
  const env = {};
  apply({aiTrial: true}, env);
  assert.equal(env.ANTHROPIC_BASE_URL, FREE_BASE);
});

test('stop (own key saved) and apply at start-up restore Anthropic directly', () => {
  const env = {ANTHROPIC_BASE_URL: FREE_BASE}, st = storage({aiFree: true});
  stop(st, env);
  assert.equal(st.settings().aiFree, false);
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  apply({aiFree: true}, env);
  assert.equal(env.ANTHROPIC_BASE_URL, FREE_BASE);
});

test('the end-to-end journey sends the app\'s own AI calls to its test proxy, and only the journey does', () => {
  const env = {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_AI_BASE_URL: 'http://127.0.0.1:9'};
  apply({}, env);
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:9');
  apply({aiFree: true}, env);
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:9');   // the proxy wins over Free AI in a test run
  const real = {JOB_PILOTTO_E2E_AI_BASE_URL: 'http://127.0.0.1:9'};   // the variable alone (no JOB_PILOTTO_E2E) changes nothing
  apply({}, real);
  assert.equal(real.ANTHROPIC_BASE_URL, undefined);
});
