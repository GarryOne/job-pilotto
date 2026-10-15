import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerForm } from '../src/extension.js';
import worker from '../src/index.js';
import { WRITTEN_RULE, REVIEW_SCHEMA } from '../src/written-answer.js';

// Written questions are DRAFTED from the person's facts (owner, 16 Oct 2026, reversing the 11 Oct "expected hold"): typed and marked, an outline when the facts are thin.
const QUESTIONS = ['What is your hands-on experience operating container-orchestrated infrastructure?', 'Describe cloud infrastructure you have built.',
  'Walk us through how you make a change to production safely.', 'Describe a production incident you personally root-caused.'];
const fields = QUESTIONS.map((label, i) => ({ field: `q${i}`, label, type: 'textarea', required: true }));
const reply = (answers) => ({ stop_reason: 'end_turn', usage: { billing: 'subscription' }, content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', answers }) }] });
const env = { PROFILE_TEXT: 'Name: Ada\nSRE at Acme', ANSWERS_TEXT: '', KNOWLEDGE_TEXT: '', CV_FACTS_TEXT: 'done at Acme: ran Kubernetes clusters' };
const one = (value, confidence, i = 0, extra = {}) => ({ field: `q${i}`, value, confidence, note: '', category: 'written', use: 'fill', fact: 'none', ...extra });

test('a drafted written question is typed and marked draft; a thin-facts one is an outline; an empty one stays a kind', async () => {
  const out = await answerForm(env, { url: 'https://example.test/job/1', fields },
    { messages: { create: async () => reply([one('I ran the Kubernetes clusters at Acme.', 'medium', 0), one('• Add: which incident, what the root cause was', 'low', 3), one('', 'low', 1)]) } });
  const by = Object.fromEntries(out.answers.map((a) => [a.field, a]));
  assert.deepEqual([by.q0.use, by.q0.draft, by.q0.value], ['fill', 'draft', 'I ran the Kubernetes clusters at Acme.']);
  assert.deepEqual([by.q3.use, by.q3.draft], ['fill', 'outline'], 'low confidence: an outline to complete, never a finished answer');
  assert.deepEqual([by.q1.use, by.q1.value, by.q1.draft], ['kind', '', undefined], 'no text at all: the old kind');
  assert.equal(out.answers.filter((a) => a.field === 'q1').length, 1, 'one row per field');
});

test('a draft the AI called a proposal is typed as a draft anyway (the person reviews it in the box)', async () => {
  const out = await answerForm(env, { url: 'https://example.test/job/1', fields }, { messages: { create: async () => reply([one('Draft text', 'medium', 0, { use: 'propose' })]) } });
  assert.deepEqual([out.answers[0].use, out.answers[0].draft], ['fill', 'draft']);
});

test('the prompt tells the AI to draft from the given facts only and never to invent', () => {
  for (const part of [/never invent an employer, project, tool, number, date or incident/, /• Add:/, /first person/, /never leave it as a bare empty box/]) assert.match(WRITTEN_RULE, part);
});

test('/extension/review-answer: one AI read, the form is never touched; needs a question and text', async () => {
  const seen = [];
  const aiClient = { messages: { create: async (args) => { seen.push(args); return { stop_reason: 'end_turn', usage: { billing: 'subscription' }, content: [{ type: 'text', text: JSON.stringify(
    { answers_it: false, verdict: 'No incident named.', missing: ['one incident'], improved: 'I once traced a failing rollout. • Add: the root cause' }) }] }; } } };
  const call = (body) => worker.fetch(new Request('https://w.test/extension/review-answer', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify(body) }), { ...env, EXTENSION_TOKEN: 't', aiClient });
  const bad = await call({ url: 'https://example.test/job/1', question: QUESTIONS[3], text: '' });
  assert.equal(bad.status, 400);
  const ok = await (await call({ url: 'https://example.test/job/1', question: QUESTIONS[3], text: 'Once I fixed a thing.' })).json();
  assert.deepEqual([ok.answers_it, ok.missing, ok.usd], [false, ['one incident'], 0]);
  assert.match(ok.improved, /Add:/);
  assert.equal(seen.length, 1);
  assert.ok(JSON.stringify(seen[0]).includes('Once I fixed a thing.') && JSON.stringify(seen[0]).includes('ran Kubernetes clusters'), 'the text and the person\'s facts reach the AI');
  assert.deepEqual(REVIEW_SCHEMA.required, ['answers_it', 'verdict', 'missing', 'improved']);
});
