// The AI's verdict per question, kept on this Mac so a question is never asked twice (settings.questionVerdicts, keyed by the question's normalized words),
// and the one place that turns the page's open questions into what every list shows: Jobs → Answer once, Profile → Needs review and the session's
// "what Claude needs" read it through renderer/question-filter.js. Guarded by test/question-verdicts.test.js.
import {classify} from './question-reuse.js';
import {keyOf, looksLikeFieldId, visibleQuestions} from '../renderer/question-filter.js';

const MAX = 600;
const VERSION = 2;   // 2: covered_by also by deduction (a saved permit settles "need sponsorship?"), with the saved answer it came from
export const cached = storage => storage.settings().questionVerdicts || {};

// Classifies the labels with no verdict yet (one small call), keeps the verdicts, returns the whole map. ai: {client, apiKey} (none: nothing new).
export async function ensure(storage, labels, {answered = [], company = '', host = '', ai = {}} = {}) {
  const known = cached(storage), now = new Map(answered.map(a => [a.question, a.answer]));
  // judged again: never judged, judged before answers could be deduced (no v: once), or the saved answer its proposal came from changed (or is gone)
  const stale = entry => entry && (entry.v !== VERSION || (entry.covered_by && now.get(entry.covered_by) !== entry.from));
  const fresh = [...new Set(labels.filter(label => label && !looksLikeFieldId(label) && (!known[keyOf(label)] || stale(known[keyOf(label)]))))];
  if (!fresh.length || !(ai.client || ai.apiKey)) return {verdicts: known, usage: null};
  const found = await classify({labels: fresh, answered, company, host, apiKey: ai.apiKey, client: ai.client});
  const next = {...known};
  for (const [label, verdict] of found) next[keyOf(label)] = {...known[keyOf(label)], ...verdict, v: VERSION, question: label, asked: known[keyOf(label)]?.asked || 0, at: new Date().toISOString().slice(0, 10)};
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

// A fill met these questions again: how many forms asked each, that a required one blocked the fill, and which job asked (a one-job question shows in that job's drawer).
export function record(storage, labels, {url = '', company = ''} = {}) {
  const known = cached(storage), next = {...known};
  let changed = false;
  for (const label of labels) {
    const entry = next[keyOf(label)];
    if (!entry) continue;
    const jobs = (entry.jobs || []).filter(job => job.url !== url);
    next[keyOf(label)] = {...entry, question: entry.question || label, asked: (entry.asked || 0) + 1, blocked: true, jobs: url ? [...jobs, {url, company}].slice(-5) : jobs};
    changed = true;
  }
  if (changed) storage.saveSettings({questionVerdicts: next});
}

// The questions only this job asked ([{question}]): read from the kept verdicts, shown in the job's drawer.
export const forJob = (storage, url) => Object.values(cached(storage)).filter(entry => entry.reuse === 'one_job' && (entry.jobs || []).some(job => job.url === url))
  .map(entry => ({question: entry.question || ''})).filter(entry => entry.question);
