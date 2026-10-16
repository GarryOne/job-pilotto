// A consent is never typed from the AI's answer alone (16 Oct 2026): a legal answer is an empty kind whatever its use, and a box with no saved fact behind it is a proposal.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerForm } from '../src/extension.js';

const ask = async (fields, answers) => {
  const client = { messages: { create: async () => ({ stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', pay_asks: [], answers }) }] }) } };
  const env = { PROFILE_TEXT: '# Alex', ANSWERS_TEXT: '', KNOWLEDGE_TEXT: '', SEARCH_TEXT: '', CV_FACTS_TEXT: '', store: { findJob: async () => null, kit: async () => null } };
  return (await answerForm(env, { url: 'https://example.com/j', fields, page_text: 'x' }, client)).answers;
};
const answer = (over) => ({ field: 'a', value: 'checked', confidence: 'high', note: '', category: 'normal', use: 'fill', fact: 'none', ...over });

test('a legal answer comes back as an empty kind for every field type and every use', async () => {
  for (const type of ['checkbox', 'radio', 'select', 'text', 'combobox']) for (const use of ['fill', 'propose']) {
    const got = await ask([{ field: 'a', label: 'Consent', type, required: true, options: ['Yes', 'No'] }], [answer({ category: 'legal', use, value: 'Yes' })]);
    assert.deepEqual(got.map((a) => [a.value, a.category, a.use]), [['', 'legal', 'kind']], `${type} ${use}`);
  }
});

test('a box with no saved fact behind it is only proposed; one resting on a saved fact is typed; other field types are unchanged', async () => {
  const box = { field: 'a', label: 'I am happy with this', type: 'checkbox', required: true };
  assert.equal((await ask([box], [answer({ fact: 'none' })]))[0].use, 'propose');
  assert.equal((await ask([box], [answer({ fact: 'work_permit' })]))[0].use, 'fill');
  const text = { field: 'a', label: 'Anything else', type: 'text', required: false };
  const guessed = (await ask([text], [answer({ value: 'x', fact: 'none' })]))[0];
  assert.equal(guessed.use, 'fill');
  assert.equal(guessed.guess, true);
});
