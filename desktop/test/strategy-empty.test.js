// A drafted strategy with no roles or no job board searches is asked again once, naming them, then refused (lib/strategy-empty.js, draft()
// in lib/strategy.js). 18 Oct 2026: a Cluj candidate's fresh draft came back after 8 s with no roles, no board searches and "placeholder"
// answers, and the search read 2,045 employer sites for 47 minutes matching nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';
import * as strategy from '../lib/strategy.js';
import {PARTS, emptyParts} from '../lib/strategy-empty.js';
import {createStorage} from '../lib/storage.js';

const fakeCrypto = {available: () => true, encrypt: text => Buffer.from(text), decrypt: buffer => buffer.toString()};
function storage() {
  const made = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);
  pipeline.ensureConfig(made);
  made.writeText('cv.pdf', '%PDF-1.4 fake');
  return made;
}
const FULL = {summary: 'Senior full-stack roles in Cluj', profile_markdown: '# Hard constraints\n- Cluj-Napoca', answers_markdown: '# Eligibility\n- EU citizen',
  search: {target_roles: ['full stack developer', 'backend engineer'],
    locations: {top_tier: ['cluj'], country_wide: ['romania'], abroad: []}}};
const EMPTY = {summary: 'x', profile_markdown: '# Hard constraints', answers_markdown: 'placeholder',
  search: {target_roles: [], locations: {top_tier: [], country_wide: [], abroad: []}}};
function client(...answers) {
  const seen = [];
  return {seen, messages: {create: async request => {
    seen.push(request);
    return {stop_reason: 'end_turn', usage: {input_tokens: 10000, output_tokens: 3000}, content: [{type: 'text', text: JSON.stringify(answers[seen.length - 1])}]};
  }}};
}
const lastText = request => request.messages[0].content.at(-1).text;

test('an empty draft is asked again once, naming what it left empty, and the second answer is kept with both calls paid', async () => {
  const ai = client(EMPTY, FULL);
  const result = await strategy.draft(storage(), {}, 'sk-ant-x', ai);
  assert.equal(ai.seen.length, 2);
  assert.match(lastText(ai.seen[1]), /left target roles empty/);
  assert.equal(ai.seen[1].messages[0].content[0].type, 'document', 'the CV is sent again');
  assert.deepEqual(result.search.role_keywords, ['full stack developer', 'backend engineer']);   // the one list gives the engine's two keys
  assert.deepEqual(result.search.jobs_board_search_queries, ['full stack developer', 'backend engineer']);
  assert.equal(result.usd, 0.1);
});

test('a draft still empty after the second ask is refused, never saved as a search that matches nothing', async () => {
  await assert.rejects(strategy.draft(storage(), {}, 'sk-ant-x', client(EMPTY, EMPTY)), /The draft came back without target roles; try again/);
});

test('a full draft is asked once', async () => {
  const ai = client(FULL);
  await strategy.draft(storage(), {}, 'sk-ant-x', ai);
  assert.equal(ai.seen.length, 1);
});

test('every part the search needs is checked on its own', () => {
  assert.deepEqual(emptyParts(FULL), []);
  for (const [part, key] of [['target roles', 'target_roles']]) {
    assert.ok(part in PARTS, part);
    assert.deepEqual(emptyParts({...FULL, search: {...FULL.search, [key]: []}}), [part]);
  }
  assert.equal(Object.keys(PARTS).length, 1, 'a new part: add it to the loop above');
  assert.deepEqual(emptyParts({}), Object.keys(PARTS), 'no search at all');
});
