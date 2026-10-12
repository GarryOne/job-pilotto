// Answers from saved facts (worker/src/answer-facts.js, 12 Oct 2026): every answer names the saved fact it rests on, a typed answer that names
// none is only proposed, and on this Mac's store the ask gets the job and its drafted kit (before, a SQLite user's ask got neither).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACT_KEYS, FACT_RULE, floorUnfounded } from '../src/answer-facts.js';

const reply = (answers) => ({ stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, billing: 'subscription' },
  content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', answers }) }] });
const fakeClient = (answers, seen = []) => ({ messages: { create: async (request) => { seen.push(request); return reply(answers); } } });
const env = { PROFILE_TEXT: 'Work permit: EU citizen', ANSWERS_TEXT: '', KNOWLEDGE_TEXT: '' };
const fields = [{ field: 'permit', label: 'Do you need sponsorship to work in Switzerland?', type: 'radio', options: ['Yes', 'No'], required: true },
  { field: 'heard', label: 'How did you hear about us?', type: 'select', options: ['Website', 'Friend'], required: true }];

test('the fact list is closed, ends with "none", and the schema requires one of it on every answer', async () => {
  const { ANSWER_SCHEMA_FOR_TESTS: schema } = await import('../src/extension.js');
  const item = schema.properties.answers.items;
  assert.ok(item.required.includes('fact'));
  assert.deepEqual(item.properties.fact.enum, FACT_KEYS);
  assert.equal(FACT_KEYS.at(-1), 'none');
  assert.equal(new Set(FACT_KEYS).size, FACT_KEYS.length);
});

test('the prompt sets an answer that follows from a saved fact and proposes only what no saved fact settles', async () => {
  const seen = [];
  const { answerForm } = await import('../src/extension.js');
  await answerForm(env, { url: 'https://example.test/job/1', fields }, fakeClient([], seen));
  const system = seen[0].system[0].text;
  assert.ok(system.includes(FACT_RULE));
  assert.match(FACT_RULE, /follows from what they state/);
  assert.match(FACT_RULE, /use: "propose" and fact "none"/);
  assert.match(FACT_RULE, /a form that names no currency asks in the currency of the job's country/);
  assert.match(FACT_RULE, /settled only when the job's text or the form names that place; when neither does, it is a proposal/);
  assert.match(FACT_RULE, /referred or recommended them[^.]*when the saved facts state how they heard of the job/);
});

test('floor: a typed answer that names no saved fact is proposed, never typed; one that names a fact is typed', () => {
  assert.equal(floorUnfounded({ use: 'fill', fact: 'none', value: 'Website' }).use, 'propose');
  assert.equal(floorUnfounded({ use: 'fill', fact: 'work_permit', value: 'No' }).use, 'fill');
  assert.equal(floorUnfounded({ use: 'fill', value: 'No' }).use, 'fill', 'an older reply shape with no fact is left as it was');
  assert.equal(floorUnfounded({ use: 'fill', fact: 'none', value: 'x' }, { test: true }).use, 'fill', 'test mode types invented values on purpose');
  for (const category of ['legal', 'demographic']) {
    assert.equal(floorUnfounded({ use: 'fill', fact: 'none', value: 'Decline to self-identify', category }).use, 'fill', `${category}: its own rule decides (a decline choice is typed)`);
  }
});

test('answerForm: the saved-fact answer is typed, the unfounded one comes back as a proposal', async () => {
  const { answerForm } = await import('../src/extension.js');
  const out = await answerForm(env, { url: 'https://example.test/job/1', fields }, fakeClient([
    { field: 'permit', value: 'No', confidence: 'high', note: '', category: 'knockout', use: 'fill', fact: 'sponsorship' },
    { field: 'heard', value: 'Website', confidence: 'medium', note: 'guess', category: 'normal', use: 'fill', fact: 'none' }]));
  const use = Object.fromEntries(out.answers.map((a) => [a.field, a.use]));
  assert.deepEqual(use, { permit: 'fill', heard: 'propose' });
  assert.equal(out.answers.find((a) => a.field === 'permit').fact, 'sponsorship');
});

test('with the data on this Mac (env.store) the ask gets the job and its drafted kit, and returns the job', async () => {
  const seen = [];
  const store = {
    findJob: async (url) => (url === 'https://example.test/job/1' ? { id: 'a1', title: 'SRE', company: 'Acme', stage: 'To apply', url, notion_url: '' } : null),
    kit: async (id) => (id === 'a1' ? { answers: [{ field: 'why', question: 'Why us?', answer: 'Your platform.' }], cover_letter: 'Dear Acme' } : null),
  };
  const { answerForm } = await import('../src/extension.js');
  const out = await answerForm({ ...env, store }, { url: 'https://example.test/job/1', fields }, fakeClient([], seen));
  const user = seen[0].messages[0].content;
  assert.match(user, /SRE at Acme/);
  assert.match(user, /<drafted_kit>[\s\S]*Your platform\./);
  assert.deepEqual(out.job, { title: 'SRE', company: 'Acme', stage: 'To apply', url: 'https://example.test/job/1', notion_url: '' });
  assert.equal(out.cover_letter, 'Dear Acme');
});
