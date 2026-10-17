// The early key check: a refused key stops the suite with its name; a good key, a down network or an unknown engine do not.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {CHECKED_ENGINES, CLAUDE_MODELS, checkKeyAccepted} from '../lib/key-check.mjs';

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

test('the Claude models checked are the ones src/ai/models.py names', () => {
  const models = fs.readFileSync(path.resolve(import.meta.dirname, '../../../src/ai/models.py'), 'utf8');
  const named = [...models.matchAll(/(?:SMALL|MAIN|BIG)_MODEL = (?:os\.getenv\([^)]*\) or )?'(claude-[\w.-]+)'/g)].map(match => match[1]);
  assert.deepEqual([...CLAUDE_MODELS].sort(), named.sort());
});

test('a model the API refuses stops the suite with the model and the API\'s words, key-shaped text removed; a limit does not', async () => {
  const refusing = (status, message) => async url => url.endsWith('/count_tokens') ? {status, json: async () => ({error: {message}})} : {status: 200};
  await assert.rejects(checkKeyAccepted({engine: 'api', key: 'k', fetchImpl: refusing(400, 'model: claude-haiku-5-5 is not available key sk-ant-api03-abcdefghijkl')}),
    error => /claude-haiku-5-5 \(400\)/.test(error.message) && /not available/.test(error.message) && !/abcdefghijkl/.test(error.message));
  await assert.rejects(checkKeyAccepted({engine: 'api', key: 'k', fetchImpl: refusing(404, 'not_found')}), /\(404\)/);
  await checkKeyAccepted({engine: 'api', key: 'k', fetchImpl: refusing(429, 'rate limited')});
  await checkKeyAccepted({engine: 'openai', key: 'k', fetchImpl: refusing(400, 'never asked: OpenAI has no count_tokens here')});
});
