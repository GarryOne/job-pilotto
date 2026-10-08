// "Your details from your CV": Claude reads the CV once per CV file and proposes a value for each empty contact field it states
// (phone, street, postal code, town, date of birth, place of origin, salutation…). Nothing is saved here: the proposals fill the
// empty boxes of Settings → Profile → Your details, marked "from your CV", and Save there is the confirmation (owner, 8 Oct 2026:
// a Coop form stopped on 9 questions whose answers were half in the CV). A field you filled is never proposed over.
// Guarded by test/contact-from-cv.test.js.
import fs from 'node:fs';
import {LABELS} from './contact.js';
import {inFlight} from './in-flight.js';

export const MODEL = 'claude-haiku-5-5';
export const FILE = 'cv/contact-proposals.json';
const NEVER = new Set(['full_name']);   // made from first + last name on Save
export const FIELDS = Object.keys(LABELS).filter(key => !NEVER.has(key));

const INSTRUCTIONS = `You read a CV and copy the applicant's own contact details out of it, to prefill a form they will check.
Return one proposal per requested field that the CV states. Copy values as written (phone with its country code if the CV has one).
location is the town or city they live in; street is street and number only; postal_code is the postal code only.
salutation is how forms address them (e.g. "Mr", "Ms", or the CV's own language: "Monsieur", "Madame", "Herr", "Frau"): propose it only when the CV
shows it (a title, a gendered word such as "né"/"née" or "geboren als"), with sure=false. Never invent a value, never guess from a name alone.
Leave out a field the CV does not give. sure=true only when the CV states the value plainly.`;

const SCHEMA = {type: 'object', additionalProperties: false, required: ['proposals'], properties: {proposals: {type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['field', 'value', 'sure'],
  properties: {field: {type: 'string', enum: FIELDS}, value: {type: 'string'}, sure: {type: 'boolean'}}}}}};

// The fields worth asking about: known, and empty in what you saved.
export const emptyFields = (contact = {}) => FIELDS.filter(key => !String(contact?.[key] || '').trim());

// Claude's answer, kept to the requested fields, one per field, short and trimmed. → [{field, value, sure}]
export function cleanProposals(raw, wanted) {
  const allowed = new Set(wanted), seen = new Set();
  return (Array.isArray(raw) ? raw : []).flatMap(item => {
    const field = String(item?.field || ''), value = String(item?.value || '').trim().slice(0, 200);
    if (!allowed.has(field) || !value || seen.has(field)) return [];
    seen.add(field);
    return [{field, value, sure: field === 'salutation' ? false : item?.sure === true}];
  });
}

// The proposals kept for this CV, still for empty fields only (a field you filled since drops out). → [] when none or another CV.
export function pending(saved, cvHash, contact) {
  if (!saved || !cvHash || saved.cv !== cvHash) return [];
  const empty = new Set(emptyFields(contact));
  return (saved.proposals || []).filter(item => empty.has(item.field));
}

// One Claude call on the CV PDF. → {proposals, usd?} ; throws on an AI failure (the caller says why).
export async function propose(client, cvPdf, wanted) {
  if (!wanted.length) return {proposals: []};
  const response = await client.messages.create({
    model: MODEL, max_tokens: 8000, system: INSTRUCTIONS,   // room for thinking (an answer cut short is not JSON)
    messages: [{role: 'user', content: [
      {type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: Buffer.from(cvPdf).toString('base64')}},
      {type: 'text', text: `Fields to fill: ${wanted.map(key => `${key} (${LABELS[key]})`).join(', ')}`}]}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}},
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to read the CV');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude\'s answer was cut short');
  const text = response.content?.find(block => block.type === 'text')?.text || '{}';
  return {proposals: cleanProposals(JSON.parse(text).proposals, wanted)};
}

// The proposals for the CV there is now: kept ones, or one call when this CV was never read for them (once per CV file, a failure
// included, so opening Profile never pays twice; `again` asks anew). → {proposals, cv, fresh, error?}
const once = inFlight();
export function forCv(storage, options = {}) {   // the same CV asked twice at once (the session page and Profile at start): one call
  return options.again || !options.cvHash ? forCvNow(storage, options) : once(options.cvHash, () => forCvNow(storage, options));
}
async function forCvNow(storage, {contact, client, cvHash, again = false, log = () => {}, read = fs.readFileSync} = {}) {
  let saved = null;
  try { saved = JSON.parse(storage.readText(FILE) || 'null'); } catch {}
  if (!cvHash) return {proposals: [], cv: ''};
  if (saved?.cv === cvHash && !again) return {proposals: pending(saved, cvHash, contact), cv: cvHash, fresh: false, error: saved.error || ''};
  if (!client) return {proposals: [], cv: cvHash, fresh: false, error: 'no AI'};
  const wanted = emptyFields(contact), started = Date.now();
  let proposals = [], error = '';
  try { ({proposals} = await propose(client, read(storage.path('cv.pdf')), wanted)); } catch (failure) { error = String(failure?.message || failure).slice(0, 200); }
  storage.writeText(FILE, JSON.stringify({cv: cvHash, at: new Date().toISOString(), proposals, ...(error ? {error} : {})}));
  // Which fields, never their values (lib/log.js): enough to tell "nothing in the CV" from "Claude failed".
  log('profile', error ? `details from the CV: failed: ${error}` : `details from the CV: ${proposals.length} of ${wanted.length} proposed`,
    {cv: cvHash, asked: wanted, proposed: proposals.map(item => item.field), ms: Date.now() - started});
  return {proposals: pending({cv: cvHash, proposals}, cvHash, contact), cv: cvHash, fresh: true, error};
}
