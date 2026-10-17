// Which questions a fill couldn't answer are worth keeping on the Standard answers page: a field with no readable label is never a
// question (structure), and whether a question comes back on other applications is the AI's call with a fixed answer this file validates
// (owner, 17 Oct 2026: "text-3219", "Colonist Profile" and one-off essays filled "Needs review"). Guarded by test/question-reuse.test.js.
import {anthropicApi} from './ai/anthropic-api.js';

export const MODEL = 'claude-haiku-5-5';
export const VERDICTS = ['reusable', 'one_job'];

// A form field's own id where no label was readable ("text-3219", "tel-3519", "question_12"): one token with a digit, no spaces. By shape, no words.
export const looksLikeFieldId = text => {
  const label = String(text || '').replace(/^[\s*]+|[\s*]+$/g, '');
  return !label || (!/\s/.test(label) && /\d/.test(label) && /^[\w.:[\]-]+$/.test(label));
};

const SCHEMA = {type: 'object', additionalProperties: false, required: ['verdicts'], properties: {verdicts: {type: 'array', items: {type: 'object', additionalProperties: false,
  required: ['label', 'verdict'], properties: {label: {type: 'string'}, verdict: {type: 'string', enum: VERDICTS}}}}}};
const INSTRUCTIONS = `A job-application form asked these questions and the applicant's saved answers had none. For each, decide whether it is worth saving as a
standard answer the applicant will want again on OTHER employers' forms (a fact about them or a stable stance: notice period, visa, salary, how they heard
of jobs, a degree) = "reusable"; or it belongs to this one job or employer (it names the company or its product, asks why this company, a motivation or
essay written for this role, a trivia or skill test about this employer) = "one_job". Answer every label exactly as given; when unsure answer "one_job".`;

// labels -> the Set of labels the AI judged reusable. Anything the AI left out, mangled or answered unclearly is not kept.
export async function reusable({labels, company = '', host = '', apiKey = '', client = null}) {
  if (!labels.length) return new Set();
  const ai = client || (apiKey ? anthropicApi(apiKey) : null);
  if (!ai) return new Set();
  const response = await ai.messages.create({
    model: MODEL, max_tokens: 1500, system: INSTRUCTIONS,
    messages: [{role: 'user', content: `<employer>${company}</employer>\n<site>${host}</site>\n<questions>\n${JSON.stringify(labels)}\n</questions>`}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}, effort: 'low'},
  });
  const text = response.content?.find(block => block.type === 'text')?.text || '{"verdicts":[]}';
  const keep = new Set();
  for (const {label, verdict} of JSON.parse(text).verdicts || []) if (verdict === 'reusable' && labels.includes(label)) keep.add(label);
  return keep;
}
