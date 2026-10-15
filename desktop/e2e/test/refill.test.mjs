// The CI refill's rules (lib/refill.mjs, refill-pick.mjs, lib/ai-proxy.mjs maxCalls, lib/fill-memo.mjs oldKeysKept): the matrix pick, the cap, the no-fallback key, the fork guard, old answers kept.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {capRefusal, creditsLine, forkRefusal, keyRefusal, MAX_ASKS, needsRefill, outOfCredits, pickRefill, refillKey, SECRET} from '../lib/refill.mjs';
import {oldKeysKept} from '../lib/fill-memo.mjs';
import {fillOn} from '../../lib/ai/model-memo.js';
import {startAiProxy} from '../lib/ai-proxy.mjs';

const askChanged = (extra = 2) => ({name: 'a', network: {extra}, firstMiss: {differs: ['user:1']}});
const promptChanged = {name: 'b', network: {extra: 1}, firstMiss: {differs: ['system:0']}};

test('the pick takes only the pinned rows whose gate verdict is ask changed or out of date', () => {
  const records = [askChanged(), promptChanged, {name: 'c', network: {extra: 0}, firstMiss: null}, {...askChanged(), name: 'unpinned'}, {...askChanged(), name: 'd', deferred: 'x'}];
  const picked = pickRefill({pins: ['a', 'b', 'c', 'd'], records});
  assert.deepEqual(picked.rows.map(row => row.name), ['a', 'b']);
  assert.equal(picked.asks, 3);
  assert.equal(picked.usd, 0.18);
  assert.equal(needsRefill(records[2]), false);
});

test('all takes every pinned row, at least one ask each, and no row that is not pinned', () => {
  const picked = pickRefill({pins: ['a', 'z'], records: [askChanged(4)], all: true});
  assert.deepEqual(picked.rows, [{name: 'a', asks: 4}, {name: 'z', asks: 1}]);
});

test('the cap refuses a run above the asks or the dollars, and says the estimate', () => {
  assert.equal(capRefusal({asks: 10, usd: 0.6}), '');
  assert.match(capRefusal({asks: MAX_ASKS + 1, usd: 1}), /above the cap of 40/);
  assert.match(capRefusal({asks: 10, usd: 9}), /above the \$3 cap/);
  assert.match(capRefusal({asks: 10, usd: 0.6}, {maxAsks: 5}), /cap of 5/);
});

test('the key has no fallback: another key in the environment is never used', () => {
  const others = {ANTHROPIC_API_KEY: 'a', E2E_ANTHROPIC_KEY: 'b', LIVE_POOL_ANTHROPIC_KEY: 'c'};
  assert.equal(refillKey(others), '');
  assert.match(keyRefusal(others), /no REPLAY_REFILL_ANTHROPIC_KEY/);
  assert.equal(refillKey({...others, [SECRET]: 'k'}), 'k');
  assert.equal(keyRefusal({[SECRET]: 'k'}), '');
});

test('a fork PR, or an unknown one, never gets the key', () => {
  assert.equal(forkRefusal({number: 5, isCrossRepository: false}), '');
  assert.match(forkRefusal({number: 5, isCrossRepository: true}), /fork/);
  assert.match(forkRefusal(null), /fork or unknown/);
  assert.match(forkRefusal({number: 5}), /fork or unknown/);
});

test('an empty balance or a spent limit is named as out of credits', () => {
  assert.equal(outOfCredits({'400 invalid_request_error: Your credit balance is too low to access the Anthropic API.': 2}), true);
  assert.equal(outOfCredits({'429 rate_limit_error: slow down': 1}), false);
  assert.match(creditsLine, /OUT OF CREDITS/);
});

test('a fill asks the model on CI only with the refill flag, never otherwise', () => {
  const base = {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_MODEL_MEMO_ONLY: '1', JOB_PILOTTO_MODEL_MEMO_FILL: '1'};
  assert.equal(fillOn(base), true, 'a Mac');
  assert.equal(fillOn({...base, CI: 'true'}), false, 'CI without the flag');
  assert.equal(fillOn({...base, GITHUB_ACTIONS: 'true'}), false);
  assert.equal(fillOn({...base, CI: 'true', JP_REFILL_CI: '1'}), true, 'CI through the refill workflow');
});

test('old answer keys are never lost or changed; a new key is fine', () => {
  assert.deepEqual(oldKeysKept({a: 1, 'a#ms': 5}, {a: 1, 'a#ms': 5, b: 2}), []);
  assert.deepEqual(oldKeysKept({a: 1, c: 3}, {a: 2}), ['a', 'c']);
});

test('the proxy refuses the paid call past its cap before it reaches the API', async () => {
  const proxy = await startAiProxy({target: 'http://127.0.0.1:1', maxCalls: 1});
  try {
    const ask = () => fetch(`${proxy.url}/v1/messages`, {method: 'POST', body: '{}', headers: {'content-type': 'application/json'}});
    assert.equal((await ask()).status, 502, 'the first call goes out (to a closed port here)');
    const second = await ask();
    assert.equal(second.status, 400);
    assert.match(await second.text(), /cap of 1 paid calls/);
  } finally { await proxy.close(); }
});
