// What the AI judges about the questions a form asked: reusable across jobs or one job's, and whether the applicant's standard answers already cover it
// (owner, 17 Oct 2026: "text-3219", "Colonist Profile", one-off essays and "earliest start date" filled Needs review / Answer once). The fixed answer is
// validated here: an unknown label, an unclear verdict or a covered_by that is not one of the given answers keeps nothing. Guarded by test/question-reuse.test.js.
import {anthropicApi} from './ai/anthropic-api.js';
import {keyOf, looksLikeFieldId} from '../renderer/question-filter.js';

export {looksLikeFieldId};
export const MODEL = 'claude-haiku-5-5';
export const VERDICTS = ['reusable', 'one_job', 'consent'];

const SCHEMA = {type: 'object', additionalProperties: false, required: ['verdicts'], properties: {verdicts: {type: 'array', items: {type: 'object', additionalProperties: false,
  required: ['label', 'verdict', 'covered_by'], properties: {label: {type: 'string'}, verdict: {type: 'string', enum: VERDICTS}, covered_by: {type: 'string'}}}}}};
const INSTRUCTIONS = `A job-application form asked these questions. For each decide its verdict:
- "reusable": a fact about the applicant or a stable stance they will want to give again on OTHER employers' forms (notice period, visa, salary, how they heard of jobs, a degree).
- "one_job": it belongs to this one job or employer (it names the company or its product, asks why this company, a motivation or essay written for this role, a trivia or skill test).
- "consent": a legal or privacy consent / agreement checkbox or statement.
Then covered_by: when the applicant's saved answers (given as questions) already answer it, the EXACT saved question that covers it (a differently worded notice-period question is covered by the notice period answer); otherwise "".
Answer every label exactly as given; when unsure answer "one_job" and "".`;

// labels, answered: [{question, answer}] -> Map(label -> {reuse, covered_by (an exact answered question or ''), proposal}); a label the AI left out or mangled is absent.
export async function classify({labels, answered = [], company = '', host = '', apiKey = '', client = null}) {
  const out = new Map();
  if (!labels.length) return out;
  const ai = client || (apiKey ? anthropicApi(apiKey) : null);
  if (!ai) return out;
  const response = await ai.messages.create({
    model: MODEL, max_tokens: 2000, system: INSTRUCTIONS,
    messages: [{role: 'user', content: `<employer>${company}</employer>\n<site>${host}</site>\n<saved_answers>\n${JSON.stringify(answered.map(a => a.question)).slice(0, 6000)}\n</saved_answers>\n<questions>\n${JSON.stringify(labels)}\n</questions>`}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}, effort: 'low'},
  });
  const text = response.content?.find(block => block.type === 'text')?.text || '{"verdicts":[]}';
  const byQuestion = new Map(answered.map(a => [a.question, a.answer]));
  for (const {label, verdict, covered_by: covered} of JSON.parse(text).verdicts || []) {
    if (!labels.includes(label) || !VERDICTS.includes(verdict)) continue;
    const answer = byQuestion.get(covered);
    out.set(label, {reuse: verdict, covered_by: answer ? covered : '', proposal: answer || ''});
  }
  out.usage = response.usage || {};
  return out;
}

// The older shape the fill-time collect uses: the Set of labels worth saving (reusable and not already covered).
export async function reusable(options) {
  const verdicts = await classify(options);
  return new Set([...verdicts].filter(([, v]) => v.reuse === 'reusable' && !v.covered_by).map(([label]) => label));
}
export {keyOf};
