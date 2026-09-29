import test from 'node:test';
import assert from 'node:assert/strict';
import {apply, start, stop, TRIAL_BASE, isTrialKey} from '../lib/ai-trial.js';

const storage = (settings = {}) => { let s = settings; const secrets = {};
  return {settings: () => s, saveSettings: p => { s = {...s, ...p}; }, setSecret: (n, v) => { secrets[n] = v; }, secret: n => secrets[n], secrets}; };

test('start: only with a license; uses the license key and points the SDKs at the trial endpoint', () => {
  const env = {};
  assert.equal(start(storage(), () => ({licensed: false}), env).ok, false);
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  const st = storage({license: {key: 'JP1.abc.def'}});
  assert.deepEqual(start(st, () => ({licensed: true}), env), {ok: true});
  assert.equal(st.secrets.ANTHROPIC_API_KEY, 'JP1.abc.def');
  assert.equal(env.ANTHROPIC_BASE_URL, TRIAL_BASE);
  assert.ok(isTrialKey(st.secrets.ANTHROPIC_API_KEY));
});

test('stop (own key saved) and apply at start-up restore Anthropic directly', () => {
  const env = {ANTHROPIC_BASE_URL: TRIAL_BASE};
  const st = storage({aiTrial: true});
  stop(st, env);
  assert.equal(st.settings().aiTrial, false);
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  apply({aiTrial: true}, env);
  assert.equal(env.ANTHROPIC_BASE_URL, TRIAL_BASE);
});
