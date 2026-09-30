// Learning from each form fill: after a fill that left fields, one small Claude call reads that run's
// record and writes reusable notes ("Form knowledge"), using only what the user already gave (profile,
// standard answers, contact details). Notes are kept in settings.json (formKnowledge, used by the
// extension at fill time) and mirrored to a "🧠 Form knowledge" page in the user's Notion (read by kit
// drafting and on-page answering, and where the user reads or deletes them). Missing personal facts are
// not guessed: they stay in the "Answer once" list.
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-haiku-4-5';
const PRICE = {input: 1, output: 5};  // USD per million tokens
export const PAGE_TITLE = '🧠 Form knowledge';
const MAX_NOTES = 300;

const object = properties => ({type: 'object', additionalProperties: false, required: Object.keys(properties), properties});
export const SCHEMA = object({
  notes: {type: 'array', items: object({
    scope: {type: 'string', description: 'Where it applies: the job site host given (default), or "any" if it holds on every site'},
    field: {type: 'string', description: 'The field label exactly as on the form'},
    kind: {type: 'string', enum: ['answer', 'option', 'widget', 'meaning']},
    value: {type: 'string', description: 'For answer/option: the exact value or option label to use; else ""'},
    note: {type: 'string', description: 'One short sentence: the reusable lesson'},
  })},
});

const INSTRUCTIONS = `You improve a job-application form filler. You get one fill's record: the fields it left unfilled (with the
form's label, type and options), the answers it had, and the candidate's profile, standard answers and contact details.
Write short reusable notes that let the next fill complete these fields, ONLY from facts already given:
- answer: a field that maps to a known fact (e.g. "Preferred First Name" = the first name). value = the exact text.
- option: which listed option matches a standard answer (e.g. "How did you hear" → "Careers Website"). value = the option label, verbatim.
- widget: how a field must be operated (e.g. "type the city, then pick the suggestion").
- meaning: what an ambiguous label means for this candidate.
Never invent personal facts (salary, dates, identity, eligibility) that the given material doesn't state; skip those fields.
Never write notes about legal or consent checkboxes. No notes if nothing is reusable. Keep each note under 25 words.`;

export const labelKey = label => String(label || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const siteOf = url => { try { return new URL(url).hostname; } catch { return ''; } };

// Per site, not per job page: only fields this site hasn't been studied for yet go to the AI (30 Greenhouse
// forms share their widgets and questions). `studied` = {site: [label keys already sent]}.
export function newFields(run, studied = {}, known = []) {
  const site = siteOf(run.url);
  const seen = new Set([...(studied[site] || []), ...known.filter(n => n.scope === 'any' || site.includes(n.scope)).map(n => labelKey(n.field))]);
  return (run.trace || []).filter(f => f.outcome !== 'filled' && !/legal|consent/i.test(f.reason || '') && !seen.has(labelKey(f.label)));
}

export const knowledgeKey = note => `${note.scope}|${note.field}`.toLowerCase().replace(/\s+/g, ' ').trim();

// Merge new notes into the stored list (a newer note for the same scope + field replaces the older one).
export function merge(existing, notes) {
  const byKey = new Map((existing || []).map(note => [knowledgeKey(note), note]));
  for (const note of notes) if (note.field && note.note) byKey.set(knowledgeKey(note), {...note, at: new Date().toISOString()});
  return [...byKey.values()].slice(-MAX_NOTES);
}

// The notes as text for AI prompts (kits, on-page answers).
export const asText = notes => (notes || []).map(n => `- [${n.scope}] ${n.field}: ${n.note}${n.value ? ` → "${n.value}"` : ''}`).join('\n');

export async function learn({run, profile = '', answers = '', contact = {}, known = [], studied = {}, apiKey, client = null}) {
  const left = newFields(run, studied, known);
  if (!left.length) return {notes: [], usd: 0};
  const labels = new Set(left.map(f => f.label));
  const form = (run.debug?.form || []).filter(f => labels.has(f.label) || left.some(l => (f.label || '').includes(l.label)));
  let host = '';
  try { host = new URL(run.url).hostname; } catch {}
  const anthropic = client || new Anthropic({apiKey});
  const response = await anthropic.messages.create({
    model: MODEL, max_tokens: 2000,
    system: INSTRUCTIONS,
    messages: [{role: 'user', content: [
      `<site>${host}</site>\n<job>${run.url}</job>`,
      `<left_unfilled>\n${JSON.stringify(left)}\n</left_unfilled>`,
      `<form_fields>\n${JSON.stringify(form).slice(0, 12000)}\n</form_fields>`,
      `<answers_used>\n${JSON.stringify(run.debug?.answers || []).slice(0, 8000)}\n</answers_used>`,
      `<contact_details>\n${JSON.stringify(contact)}\n</contact_details>`,
      `<known_notes>\n${asText(known).slice(0, 6000)}\n</known_notes>`,
      `<profile>\n${profile.slice(0, 12000)}\n</profile>\n<standard_answers>\n${answers.slice(0, 12000)}\n</standard_answers>`,
    ].join('\n\n')}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}},
  });
  const text = response.content.find(block => block.type === 'text')?.text || '{"notes":[]}';
  const usage = response.usage || {};
  const usd = usage.billing === 'subscription' ? 0 : Math.round(((usage.input_tokens || 0) * PRICE.input + (usage.output_tokens || 0) * PRICE.output) / 1e4) / 100;
  return {notes: JSON.parse(text).notes || [], usd};
}
