// Removes the junk an older fill saved on the answers page, for every user, through the store interface (SQLite file or Notion page): an open
// question whose "label" is a field id (looksLikeFieldId, by shape) and an open question the AI judged one-job once the job it came from is kept
// with its verdict (settings.questionVerdicts, shown in that job's drawer). Reusable, covered and answered rows are never touched.
// Owner, 17 Oct 2026: "Auto-drop field ids for all", "Also delete one-job questions". Guarded by test/answers-tidy.test.js.
import {openStore} from './store/index.js';
import {isQuestionLine, parseLine} from './questions.js';
import {cached} from './question-verdicts.js';
import {keyOf, looksLikeFieldId} from '../renderer/question-filter.js';

const HOUR = 3600 * 1000;
const lastRun = new WeakMap();   // storage -> when it last ran: the lists open often, the page is read at most once an hour

// Why an open question line goes, or '' to keep it: a field id never was a question; a one-job question moves to the job it came from, so it
// must have one (no job kept with the verdict: it stays, nothing is lost).
export function whyRemove(question, verdicts) {
  if (looksLikeFieldId(question)) return 'field id';
  const entry = verdicts[keyOf(question)];
  return entry?.reuse === 'one_job' && (entry.jobs || []).length ? 'one job' : '';
}

// -> [{question, why}] removed. force: ignore the hourly pause (tests, a button).
export async function tidy(storage, {fetcher, force = false, now = Date.now()} = {}) {
  if (!force && now - (lastRun.get(storage) || 0) < HOUR) return [];
  lastRun.set(storage, now);
  const page = openStore(storage, {fetcher}).page('answers');
  const verdicts = cached(storage);
  const doomed = [];
  for (const block of await page.blocks()) {
    const text = String(block.text || '').trim();
    if (!text || !isQuestionLine(text)) continue;
    const {question} = parseLine({id: block.id, text});
    const why = whyRemove(question, verdicts);
    if (why) doomed.push({block, question, why});
  }
  for (const {block} of [...doomed].reverse()) await page.remove(block);   // last block first: this Mac's ids are line numbers
  return doomed.map(({question, why}) => ({question, why}));
}
