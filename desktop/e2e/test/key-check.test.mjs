// The early key check: a refused key stops the suite with its name; a good key, a down network or an unknown engine do not.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CHECKED_ENGINES, checkKeyAccepted} from '../lib/key-check.mjs';

const replying = status => async () => ({status});

test('every checked engine fails on 401 and 403 naming its secret, and passes on 200', async () => {
  assert.deepEqual([...CHECKED_ENGINES].sort(), ['api', 'openai']);
  for (const engine of CHECKED_ENGINES) {
    for (const status of [401, 403]) await assert.rejects(checkKeyAccepted({engine, key: 'k', fetchImpl: replying(status)}), new RegExp(`E2E_(OPENAI|ANTHROPIC)_KEY refused \\(${status}\\)`));
    await checkKeyAccepted({engine, key: 'k', fetchImpl: replying(200)});
    await checkKeyAccepted({engine, key: 'k', fetchImpl: replying(429)});   // a limit is the AI's own line, not a refusal
    await checkKeyAccepted({engine, key: 'k', fetchImpl: async () => { throw new Error('offline'); }});
  }
});

test('the key is sent to its own provider only, and never printed', async () => {
  for (const [engine, host] of [['openai', 'api.openai.com'], ['api', 'api.anthropic.com']]) {
    let seen = null;
    await assert.rejects(checkKeyAccepted({engine, key: 'sk-secret', fetchImpl: async (url, options) => { seen = {url, options}; return {status: 401}; }}), error => !/sk-secret/.test(error.message));
    assert.equal(new URL(seen.url).host, host);
  }
});

test('a CLI engine, no key or an unknown engine is not checked', async () => {
  for (const engine of ['cli', 'codex', 'other']) await checkKeyAccepted({engine, key: 'k', fetchImpl: () => { throw new Error('must not call'); }});
  await checkKeyAccepted({engine: 'openai', key: '', fetchImpl: () => { throw new Error('must not call'); }});
});
