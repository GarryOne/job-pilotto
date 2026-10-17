// Strategy's chip lists (owner, 17 Oct 2026: "One chip per meaning", "Did you mean…"): the AI's groups and typos are kept only when every entry is
// one it was given, an entry sits in one group, a suggestion differs; the answer is cached by the lists and asked again only when they change.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import {judgeLists, meaningsFor} from '../lib/list-meanings.js';

// The owner's shapes (his screenshot 1183, 17 Oct 2026).
const LISTS = {titleSkip: ['tax', 'legal', 'counsel', 'Accountanting', 'sales'], skip: ['SonarSource', 'Sonar'], remoteSkip: ['USA', 'United States', 'US', 'Canada']};
const ANSWER = {lists: [
  {name: 'titleSkip', groups: [], typos: [{entry: 'Accountanting', suggestion: 'Accounting'}, {entry: 'legal', suggestion: 'legal'}]},
  {name: 'skip', groups: [{main: 'SonarSource', others: ['Sonar']}], typos: []},
  {name: 'remoteSkip', groups: [{main: 'United States', others: ['USA', 'US']}, {main: 'US', others: ['Canada']}, {main: 'Mexico', others: ['Canada']}], typos: []},
  {name: 'nonsense', groups: [{main: 'a', others: ['b']}], typos: []}]};
const fake = (answer, calls = []) => ({client: {messages: {create: async request => { calls.push(request); return {content: [{type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer)}]}; }}}});

test('groups and typos are kept only for entries the AI was given; one group per entry; a suggestion must differ', async () => {
  const calls = [];
  const got = await judgeLists(LISTS, fake(ANSWER, calls));
  assert.deepEqual(got.skip.groups, [{main: 'SonarSource', others: ['Sonar']}]);
  assert.deepEqual(got.remoteSkip.groups, [{main: 'United States', others: ['USA', 'US']}], 'US is in one group only; Mexico was never given');
  assert.deepEqual(got.titleSkip.typos, [{entry: 'Accountanting', suggestion: 'Accounting'}], 'a "suggestion" equal to the entry is no typo');
  assert.equal(got.nonsense, undefined);
  assert.equal(calls[0].output_config.format.type, 'json_schema');
  assert.deepEqual(await judgeLists(LISTS, fake('not json')), {}, 'mangled: chips show as they are');
  assert.deepEqual(await judgeLists(LISTS, {}), {}, 'no AI');
});

test('the answer is cached by the lists: asked once, asked again only when a list changes', async () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-meanings-')), {encrypt: v => v, decrypt: v => v});
  const calls = [];
  const ai = fake(ANSWER, calls);
  const first = await meaningsFor(storage, LISTS, ai);
  await meaningsFor(storage, LISTS, ai);
  assert.equal(calls.length, 1);
  assert.deepEqual(first.meanings.skip.groups.length, 1);
  await meaningsFor(storage, {...LISTS, skip: ['SonarSource']}, ai);
  assert.equal(calls.length, 2);
});
