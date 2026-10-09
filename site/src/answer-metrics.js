// The AI's own answers to form questions, per AI family, for /admin/form-filling (owner, 9 Oct 2026: compare the AI itself, Claude vs
// OpenAI, not the user mix). Reads form_answers (migration 0046, stored by src/knowledge.js from the apps' counts, desktop/lib/answer-counts.js).
// Counts only. Guarded by site/test/answer-metrics.test.js.
import {MS_BUCKETS} from '../../desktop/lib/answer-counts.js';
import {MS_COLUMNS} from './knowledge.js';
import {esc} from './stats.js';

export const ANSWER_FAMILIES = [['claude', 'Claude'], ['openai', 'OpenAI'], ['unknown', 'Unknown']];
const ratio = (a, b) => (b ? a / b : null);

// The median call time, as its bucket's label ("≤ 10 s", "> 80 s"), from the bucket counts; null without calls.
export function medianBucket(ms) {
  const total = ms.reduce((sum, n) => sum + n, 0);
  if (!total) return null;
  let seen = 0;
  for (let i = 0; i < ms.length; i++) {
    seen += ms[i];
    if (seen >= total / 2) return i < MS_BUCKETS.length ? `≤ ${MS_BUCKETS[i]} s` : `> ${MS_BUCKETS[MS_BUCKETS.length - 1]} s`;
  }
  return null;
}

// One period's sums -> the rates the page shows.
export function ratesOf(row) {
  const r = key => Number(row?.[key]) || 0;
  const fields = r('fields');
  return {calls: r('calls'), fields, keptRate: ratio(r('kept'), fields), emptyRate: fields ? Math.max(0, fields - r('kept')) / fields : null,
    wrongRate: ratio(r('unknown'), r('returned')), proposedShare: ratio(r('proposed'), r('kept')), cutRate: ratio(r('cut'), r('calls')),
    median: medianBucket(MS_COLUMNS.map(key => r(key)))};
}

// {claude: {now, before}, openai: {...}, unknown: {...}}: this week (from thisWeek) and the week before (lastWeek..thisWeek).
export async function answersByFamily(db, thisWeek, lastWeek) {
  const sums = ['calls', 'fields', 'returned', 'kept', 'empty', 'unknown', 'proposed', 'cut', ...MS_COLUMNS].map(key => `SUM(${key}) AS ${key}`).join(', ');
  const rows = (await db.prepare(`SELECT ai_family, CASE WHEN day >= ? THEN 'now' ELSE 'before' END AS period, ${sums} FROM form_answers WHERE day >= ? GROUP BY 1, 2`)
    .bind(thisWeek, lastWeek).all()).results || [];
  return Object.fromEntries(ANSWER_FAMILIES.map(([family]) => [family, {
    now: ratesOf(rows.find(row => row.ai_family === family && row.period === 'now')),
    before: ratesOf(rows.find(row => row.ai_family === family && row.period === 'before'))}]));
}

// The card: one row per family with calls this week; `trend` is the page's arrow (src/formlearning.js).
export function answersSection(answers, trend) {
  if (!answers) return '';
  const pct = value => (value == null ? '–' : `${Math.round(value * 100)}%`);
  const rows = ANSWER_FAMILIES.filter(([family]) => answers[family].now.calls || answers[family].before.calls).map(([family, label]) => {
    const {now, before} = answers[family];
    const cell = (key, higherIsBetter) => `<td class="n">${pct(now[key])} ${trend(now[key], before[key], higherIsBetter)}</td>`;
    return `<tr><td>${esc(label)}</td><td class="n">${now.calls}</td><td class="n">${now.fields}</td>${cell('keptRate', true)}${cell('emptyRate', false)}${cell('wrongRate', false)}
<td class="n">${pct(now.proposedShare)}</td><td class="n">${pct(now.cutRate)}</td><td class="n">${esc(now.median || '–')}</td></tr>`;
  }).join('');
  return `<section class="card"><h2>🧠 The AI's answers, by family, this week</h2><small class="muted">Each AI answer call for a form's questions, from the apps that send technical reports; arrows compare with last week. Kept = answered on a field of the form; left empty = sent and not kept; wrong field = answered under an id the form does not have; proposed = kept, shown to the person to confirm; cut = stopped at the token limit. Family from the call's own engine.</small>
<div class="wrap"><table><tr><th>Family</th><th class="n">Calls</th><th class="n">Questions</th><th class="n">Answered and kept</th><th class="n">Left empty</th><th class="n">Wrong field</th><th class="n">Proposed</th><th class="n">Cut</th><th class="n">Median time</th></tr>
${rows || '<tr><td colspan="9" class="muted">No answer calls reported yet.</td></tr>'}</table></div></section>`;
}
