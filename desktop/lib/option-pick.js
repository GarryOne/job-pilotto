// The form's own choice for an answer ("Monsieur" in a Madam/Sir menu → "Sir"), for a session page row whose field is a menu. The same
// text (any case) is taken at once; otherwise Claude picks the choice that means the same, from the choices only, or none, and the
// answer is kept per answer and set of choices (option-picks.json). Owner, 8 Oct 2026: a CV's French salutation was typed into an
// English menu. Claude sees the field's label, the answer and the choices. Guarded by test/option-pick.test.js.
export const MODEL = 'claude-haiku-5-5';
import {forget, keep, keptValue, readKept} from './kept-decisions.js';
export const FILE = 'option-picks.json';
const norm = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();

const INSTRUCTIONS = `A job application form asks a question with fixed choices. Given the applicant's answer, return the choice that means the same
(the same answer in another language or wording, e.g. "Monsieur" means "Sir" or "Mr"), copied exactly, or "" when no choice means the same.
Never pick a choice that changes the meaning.`;

const keyOf = (value, choices) => `${norm(value)}|${choices.map(norm).sort().join('|')}`;
// The page contradicted the kept answer (the banner is still there after its button was pressed): dropped, asked again next time.
export const forgetOption = (storage, {value = '', options = []}) => forget(storage, FILE, keyOf(value, (options || []).map(String).filter(option => option.trim())));
// → {choice, how: 'same' | 'ai' | 'kept' | 'none'}; choice '' when none fits (or no AI to ask).
export async function pickOption(storage, {label = '', value, options}, {client, log = () => {}} = {}) {
  const choices = (options || []).map(String).filter(option => option.trim());
  const same = choices.find(option => norm(option) === norm(value));
  if (same || !choices.length || !String(value || '').trim()) return {choice: same || '', how: same ? 'same' : 'none'};
  const kept = readKept(storage, FILE), key = keyOf(value, choices);
  const known = keptValue(kept, key);   // young answers only; a contradicted one was forgotten (lib/kept-decisions.js)
  if (known.found) return {choice: choices.includes(known.value) ? known.value : '', how: 'kept'};
  if (!client) return {choice: '', how: 'none'};
  const started = Date.now();
  try {
    const response = await client.messages.create({model: MODEL, max_tokens: 8000, system: INSTRUCTIONS,
      messages: [{role: 'user', content: JSON.stringify({question: String(label).slice(0, 200), answer: String(value).slice(0, 200), choices})}],
      output_config: {format: {type: 'json_schema', schema: {type: 'object', additionalProperties: false, required: ['choice'],
        properties: {choice: {type: 'string', enum: [...choices, '']}}}}}});
    if (response.stop_reason === 'max_tokens') throw new Error('answer cut short');
    const choice = JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}').choice;
    const picked = choices.includes(choice) ? choice : '';
    keep(storage, FILE, kept, key, picked);
    log('fill', picked ? 'a menu choice picked by meaning' : 'no menu choice means the same', {choices: choices.length, ms: Date.now() - started});
    return {choice: picked, how: 'ai'};
  } catch (error) {
    log('fill', `menu choice not picked: ${String(error?.message || error).slice(0, 160)}`, {choices: choices.length});
    return {choice: '', how: 'none'};
  }
}
