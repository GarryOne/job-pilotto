// "Do both sides mean the same places?" (owner, 17 Oct 2026: "same meaning moves silently; only a true difference is asked, in plain place names"):
// the AI's fixed answer is trusted only when every name is one it was given; the same places resolve silently; a mangled answer keeps the question;
// no AI leaves it unchecked for the next open.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {judgeSame, settleSame} from '../lib/locations-same.js';

const reply = answers => {
  const calls = [];
  const client = {messages: {create: async request => { calls.push(request); const next = answers.shift(); return {content: [{type: 'text', text: typeof next === 'string' ? next : JSON.stringify(next)}]}; }}};
  return {ai: {client}, calls};
};
const ZURICH = {kind: 'preferred', strategy: ['zürich', 'winterthur', 'zug', 'uster'], strategyFragments: ['\\bz[uü]rich\\b', '\\bwinterthur\\b', '"zug"', '\\buster\\b'], profile: ['Zurich and surroundings']};
const ABROAD = {kind: 'relocation', strategy: ['berlin', 'london', 'dubai', 'paris'], strategyFragments: ['berlin', 'london', 'dubai', 'paris'], profile: ['Berlin', 'London', 'Dubai'], profileMode: 'yes'};

test('the AI is asked with place names only, and a name it was not given makes the answer untrusted', async () => {
  const {ai, calls} = reply([{onlyStrategy: [], onlyProfile: []}, {onlyStrategy: ['Lisbon'], onlyProfile: []}, 'not json']);
  assert.deepEqual(await judgeSame(ZURICH, ai), {onlyStrategy: [], onlyProfile: []});
  assert.doesNotMatch(calls[0].messages[0].content, /\\b|\[|"/, 'names, never patterns');
  assert.equal(calls[0].output_config.format.type, 'json_schema');
  assert.equal(await judgeSame(ABROAD, ai), null, 'Lisbon was never given');
  assert.equal(await judgeSame(ABROAD, ai), null, 'mangled');
  assert.equal(await judgeSame(ABROAD, {}), null, 'no AI');
});

test('the same places in other words resolve silently; a true difference stays with what differs; checked entries are not asked again', async () => {
  const {ai, calls} = reply([{onlyStrategy: [], onlyProfile: []}, {onlyStrategy: ['paris'], onlyProfile: []}]);
  const {same, conflicts} = await settleSame([ZURICH, ABROAD], ai);
  assert.deepEqual(same, ['preferred']);
  assert.equal(conflicts.length, 1);
  assert.deepEqual({checked: conflicts[0].checked, only: conflicts[0].onlyStrategy}, {checked: true, only: ['paris']});
  const again = await settleSame(conflicts, ai);
  assert.equal(calls.length, 2, 'a checked entry is never asked again');
  assert.deepEqual(again.conflicts.length, 1);
});

test('a mangled answer keeps the question as it is; no AI leaves it unchecked; "No relocation" is a difference without asking', async () => {
  const mangled = await settleSame([ZURICH], reply(['{"onlyStrategy": ["Lisbon"], "onlyProfile": []}']).ai);
  assert.deepEqual(mangled.same, []);
  assert.equal(mangled.conflicts[0].checked, true);
  assert.equal(mangled.conflicts[0].onlyStrategy, undefined, 'no guessed difference');
  const none = await settleSame([ZURICH], {});
  assert.deepEqual(none.same, []);
  assert.equal(none.conflicts[0].checked, undefined, 'tried again on the next open');
  const {ai, calls} = reply([]);
  const no = await settleSame([{kind: 'relocation', strategy: ['berlin'], strategyFragments: ['berlin'], profile: [], profileMode: 'no'}], ai);
  assert.equal(calls.length, 0);
  assert.equal(no.conflicts.length, 1);
});
