// Which upload slot of a form takes the applicant's CV as a document (owner via cc, 11 Oct 2026, Louis Vuitton jobs: the page's own "Import data from my CV" input took the file and
// opened "your fields may be replaced, continue?" over the form). The page's structure finds the slots (extension/page/upload.js cvCandidates); Claude sees their titles and answers with
// one of them, or none: never a feature that reads the CV to fill the form in, never a cover letter or another document. Kept per set of titles. No AI, or none: the operator
// behaves as before. Titles only, never a value. Guarded by test/upload-pick.test.js.
import {keep, keptValue, readKept} from './kept-decisions.js';
export const MODEL = 'claude-haiku-5-5';
export const FILE = 'upload-picks.json';
const norm = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();

const INSTRUCTIONS = `A job application page has several file upload controls. You see their titles. Return the one title where the applicant attaches their CV (resume) as a document
that is part of the application. Never return a control that reads or imports the CV to fill in the form's fields for the applicant (an "import my details from my CV" feature),
and never one for a cover letter, certificates, a portfolio or another document. Copy the title exactly. Return "" when none of them is clearly the application's own CV slot.`;

const keyOf = titles => titles.map(norm).sort().join('|');
// → {title, how: 'ai' | 'kept' | 'none'}; title '' when none is right (or no AI to ask).
export async function pickUpload(storage, {titles = []}, {client, log = () => {}} = {}) {
  const choices = [...new Set((titles || []).map(String).map(item => item.replace(/\s+/g, ' ').trim().slice(0, 160)).filter(Boolean))].slice(0, 12);
  if (choices.length < 2) return {title: '', how: 'none'};
  const kept = readKept(storage, FILE), key = keyOf(choices);
  const known = keptValue(kept, key);
  if (known.found) return {title: choices.includes(known.value) ? known.value : '', how: 'kept'};
  if (!client) return {title: '', how: 'none'};
  const started = Date.now();
  try {
    const response = await client.messages.create({model: MODEL, max_tokens: 8000, system: INSTRUCTIONS,
      messages: [{role: 'user', content: JSON.stringify({uploads: choices})}],
      output_config: {format: {type: 'json_schema', schema: {type: 'object', additionalProperties: false, required: ['title'],
        properties: {title: {type: 'string', enum: [...choices, '']}}}}}});
    if (response.stop_reason === 'max_tokens') throw new Error('answer cut short');
    const title = JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}').title;
    const picked = choices.includes(title) ? title : '';
    keep(storage, FILE, kept, key, picked);
    log('extension', picked ? 'upload: the CV slot picked by meaning' : 'upload: no slot is clearly the CV slot', {slots: choices.length, ms: Date.now() - started});
    return {title: picked, how: 'ai'};
  } catch (error) {
    log('extension', `upload slot not picked: ${String(error?.message || error).slice(0, 160)}`, {slots: choices.length});
    return {title: '', how: 'none'};
  }
}
