// The AI's verdict per question, kept on this Mac so a question is never asked twice (settings.questionVerdicts, keyed by the question's normalized words),
// and the one place that turns the page's open questions into what every list shows: Jobs → Answer once, Profile → Needs review and the session's
// "what Claude needs" read it through renderer/question-filter.js. Guarded by test/question-verdicts.test.js.
import {classify} from './question-reuse.js';
import {keyOf, looksLikeFieldId, visibleQuestions} from '../renderer/question-filter.js';

const MAX = 600;
export const cached = storage => storage.settings().questionVerdicts || {};

// Classifies the labels with no verdict yet (one small call), keeps the verdicts, returns the whole map. ai: {client, apiKey} (none: nothing new).
export async function ensure(storage, labels, {answered = [], company = '', host = '', ai = {}} = {}) {
  const known = cached(storage);
  const fresh = [...new Set(labels.filter(label => label && !looksLikeFieldId(label) && !known[keyOf(label)]))];
  if (!fresh.length || !(ai.client || ai.apiKey)) return {verdicts: known, usage: null};
  const found = await classify({labels: fresh, answered, company, host, apiKey: ai.apiKey, client: ai.client});
  const next = {...known};
  for (const [label, verdict] of found) next[keyOf(label)] = {...verdict, asked: 1, at: new Date().toISOString().slice(0, 10)};
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX))) delete next[key];
  storage.saveSettings({questionVerdicts: next});
  return {verdicts: next, usage: found.usage || null};
}

// The shown / hidden split of rows ({question}) through the shared filter, classifying new ones first when an AI is available.
export async function split(storage, rows, options = {}) {
  const {verdicts, usage} = await ensure(storage, rows.map(row => row.question), options);
  return {...visibleQuestions(rows, verdicts), usage};
}

// The questions the standard answers already answer ([{question, answer}]): what "covered" is judged against.
export async function answeredOf(storage, groups) {
  return (groups || []).flatMap(group => group.items).filter(item => !item.open && !item.guidance && item.answer).map(item => ({question: item.question, answer: item.answer}));
}

// A fill's candidates: the Set of labels worth saving (reusable, not covered by an answer), the verdicts kept for every list.
export async function judge(storage, labels, options = {}) {
  const {verdicts} = await ensure(storage, labels, options);
  return new Set(labels.filter(label => { const v = verdicts[keyOf(label)]; return v?.reuse === 'reusable' && !v.covered_by; }));
}
