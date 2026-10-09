// The engine opens the store the app chose (lib/pipeline-env.js → src/stores chosen()): one setting, one copy of the texts.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';

const storage = settings => ({settings: () => settings, secret: () => '', path: name => `/folder/${name}`, secretsPresent: () => ({}), saveSettings: () => {}});

test('store unset: the engine is told nothing new and decides as before', () => {
  const env = pipeline.pipelineEnv(storage({}), {PATH: '/usr/bin'});
  assert.equal(env.JOB_PILOTTO_STORE, undefined);
  assert.equal(env.JOB_PILOTTO_KNOWLEDGE_FILE, undefined);
});

test('data on this Mac: the engine opens the sqlite store and the app\'s own text files', () => {
  const env = pipeline.pipelineEnv(storage({store: 'sqlite'}), {PATH: '/usr/bin'});
  assert.equal(env.JOB_PILOTTO_STORE, 'sqlite');
  assert.equal(env.JOB_PILOTTO_PROFILE_FILE, '/folder/profile.md');
  assert.equal(env.JOB_PILOTTO_ANSWERS_FILE, '/folder/answers.md');
  assert.equal(env.JOB_PILOTTO_KNOWLEDGE_FILE, '/folder/knowledge.md');
});

test('Notion chosen: the store is named, the texts stay in Notion', () => {
  const env = pipeline.pipelineEnv({...storage({store: 'notion', notionIds: {NOTION_PROFILE_PAGE_ID: 'p'}}), secret: name => (name === 'NOTION_TOKEN' ? 't' : '')}, {PATH: '/usr/bin'});
  assert.equal(env.JOB_PILOTTO_STORE, 'notion');
  assert.equal(env.JOB_PILOTTO_PROFILE_FILE, undefined);
  assert.equal(env.JOB_PILOTTO_KNOWLEDGE_FILE, undefined);
});
