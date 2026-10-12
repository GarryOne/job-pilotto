// The AI's pick of another way to write a value a site refused ("This Phone Number Format is not Allowed", HelloFresh, 11 Oct 2026): it reads only the site's own error
// message and the field's label (never the value) and answers with one of a fixed list of writings; the extension builds the text itself (extension/format-retry.js).
// A writing already tried is never chosen again. Without AI nothing changes. Guard: test/format-judge.test.js.
import {MODEL} from './page-kind.js';

export const FORMATS = ['e164', 'e164_digits', 'international_00', 'national', 'national_plain'];
const clean = (text, max) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export const schema = {type: 'object', additionalProperties: false, required: ['format', 'confidence'], properties: {
  format: {type: 'string', enum: [...FORMATS, 'none'], description: 'How to write the number next: e164 = +41795550123 (plus, no spaces); e164_digits = 41795550123 (no plus); international_00 = 0041795550123; national = 079 555 01 23 (leading 0, spaces); national_plain = 0795550123 (leading 0, no spaces); none = the message is not about how the number is written'},
  confidence: {type: 'number'}}};

export const INSTRUCTIONS = `A job application site refused a phone number the applicant typed and showed its own error message, in any language. You get the field's label, the error message, and the writings already tried (they were refused or did not help).
Pick the ONE writing from the fixed list that the message most likely asks for, never one already tried. Hints, not rules: a message about the country code or "international" wants a form with the plus or 00; one about leading zero, "national" or the local format wants a national form; one about spaces, dashes or "digits only" wants a plain form.
If the message is not about how the number is written (a missing number, a wrong country, a number that does not exist), answer none.`;

export async function judgeFormat(client, raw = {}) {
  if (!client) return {error: 'no AI'};
  const tried = (Array.isArray(raw.tried) ? raw.tried : []).filter(item => FORMATS.includes(item));
  const label = clean(raw.label, 80), message = clean(raw.message, 200);
  if (!message) return {error: 'no message'};
  try {
    const response = await client.messages.create({model: MODEL, max_tokens: 300, system: INSTRUCTIONS, output_config: {format: {type: 'json_schema', schema}, effort: 'low'},
      messages: [{role: 'user', content: [`Field: ${label || '(no label)'}`, `The site's error: ${message}`, `Writings already tried: ${tried.join(', ') || '(only the first, E.164 with spaces)'}`].join('\n')}]});
    if (response.stop_reason === 'max_tokens') return {error: 'cut off'};
    const found = JSON.parse(response.content?.find(block => block.type === 'text')?.text || '');
    const format = FORMATS.includes(found?.format) && !tried.includes(found.format) ? found.format : 'none';
    return {answer: format, format, confidence: Math.max(0, Math.min(1, Number(found?.confidence) || 0))};
  } catch (error) { return {error: String(error?.message || 'AI failed').replace(/\s+/g, ' ').slice(0, 120)}; }
}
