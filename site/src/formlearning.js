// The numbers behind the form-filling pages (Real Form Filling, Form Learning): this week vs last, from what installs report. Everything here is already counted for other pages; this puts it on one timeline.
//   1 real use (the form lab on public forms was retired 9 Oct 2026: it could not see what real fills meet): why fields stayed empty and what people answered themselves, per 100 required questions (form_exposure.required;
//     per 100 forms for apps older than 0.8.96, which send no count)
//   2 the recipe funnel (candidate -> canary -> verified, disabled).
// Counts and the forms' own public wording only. Guard: site/test/digest.test.js, thin-data.test.js.
import {slowCache} from './applying-store.js';
import {leftEmpty} from './left-empty.js';
import {answersByFamily} from './answer-metrics.js';
import {digest} from './digest.js';
import {RESULT_STATES} from '../../desktop/lib/application-result.js';

export const WEEK = 7;
// Real-use reasons (desktop/lib/question-labels.js LEFT_REASONS) in the order the page shows them, with what each means.
export const REASONS = [
  ['unread', 'Required question on the page, not read', 'blind spot'],
  ['by_you_unread', 'You answered a question the fill never read', 'blind spot'],
  ['by_you', 'You answered a question the fill left', 'gap'],
  ['page_error', 'The page flagged a question after Submit', 'gap'],
  ['no_answer', 'No answer in the profile or kit', 'data'],
  ['proposed', 'The AI proposed an answer for you to confirm', 'proposed'],
  ['not_taken', 'Answer given, the field did not take it', 'widget'],
  ['menu_not_clicked', 'Menu never clicked (setting off or the click failed)', 'widget'],
  ['menu_not_opened', 'Menu clicked, it did not open', 'widget'],
  ['menu_not_selected', 'Option clicked, the field stayed empty', 'widget'],
  ['menu_not_read', 'Selected, but the reader cannot see it', 'blind spot'],
  ['menu_other_choice', 'Menu took another choice than the answer', 'widget'],
  ['not_kept_after_tries', 'The site did not keep it after the tries', 'widget'],
  ['real_click', 'Menu left empty (older version: cause not observed)', 'widget'],
  ['no_option', 'Dropdown opened, no option matched', 'widget'],
  ['other', 'Other', 'other'],
];
const day = date => date.toISOString().slice(0, 10);
const back = (now, days) => day(new Date(now.getTime() - days * 86400000));

// {use: {fills, required, reasons: [...]}, recipes, results, learning (the digest), families, answers}
// Each rate is {ok, n, rate}; "now" is the last 7 days, "before" the 7 days before.
// How applications ended (the app's flow words from desktop/lib/application-result.js): this week and last, per board. Counts only.
export function resultsFrom(rows, thisWeek, lastWeek) {
  const blank = () => Object.fromEntries(RESULT_STATES.map(state => [state, 0]));
  const sums = {now: blank(), before: blank()}, boards = new Map();
  for (const row of rows) {
    const when = row.day >= thisWeek ? 'now' : row.day >= lastWeek ? 'before' : null;
    if (!when || !RESULT_STATES.includes(row.state)) continue;
    sums[when][row.state] += Number(row.n) || 0;
    if (when === 'now') { const cell = boards.get(row.board) || blank(); cell[row.state] += Number(row.n) || 0; boards.set(row.board, cell); }
  }
  const summary = counts => {
    const submitted = counts['submitted-clean'] + counts['submitted-assisted'] + counts['submitted-claude'], failed = counts['failed-no-form'] + counts['failed-account'] + counts['failed-abandoned'];
    return {...counts, submitted, failed, finished: submitted + failed, successRate: submitted + failed ? submitted / (submitted + failed) : null,
      cleanShare: submitted ? counts['submitted-clean'] / submitted : null, assistedShare: submitted ? counts['submitted-assisted'] / submitted : null};
  };
  return {now: summary(sums.now), before: summary(sums.before), boards: [...boards].map(([board, counts]) => ({board, ...summary(counts)})).sort((a, b) => b.finished - a.finished).slice(0, 12)};
}

// The three counts installs report, for one AI family ('' = all): src/engines.js, migration 0044.
const FAMILY_SQL = " AND (? = '' OR ai_family = ?)";

// This week, side by side per AI family: forms filled, success (submitted ÷ finished), fields left empty per 100 required questions.
export async function byFamily(db, thisWeek) {
  const out = {};
  for (const family of ['claude', 'openai', 'unknown']) {
    const use = await db.prepare('SELECT SUM(n) AS fills, SUM(required) AS required FROM form_exposure WHERE day >= ? AND ai_family = ? AND source = \'user\'').bind(thisWeek, family).first().catch(() => null);
    const left = await db.prepare('SELECT SUM(n) AS n FROM fill_reasons WHERE day >= ? AND ai_family = ? AND source = \'user\'').bind(thisWeek, family).first().catch(() => null);
    const flows = (await db.prepare('SELECT day, board, state, SUM(n) AS n FROM flow_outcomes WHERE day >= ? AND ai_family = ? GROUP BY day, board, state')
      .bind(thisWeek, family).all().catch(() => ({results: []}))).results || [];
    const results = resultsFrom(flows, thisWeek, thisWeek).now;
    const base = use?.required || use?.fills || 0;
    out[family] = {fills: use?.fills || 0, successRate: results.successRate, finished: results.finished, submitted: results.submitted,
      leftPer100: base ? (100 * (left?.n || 0)) / base : null, unit: use?.required ? 'required questions' : 'forms'};
  }
  return out;
}

export async function report(db, now = new Date(), family = '') {
  const thisWeek = back(now, WEEK - 1), lastWeek = back(now, 2 * WEEK - 1);
  const period = d => (d >= thisWeek ? 'now' : d >= lastWeek ? 'before' : null);

  const exposure = (await db.prepare('SELECT day, SUM(n) AS fills, SUM(required) AS required FROM form_exposure WHERE day >= ? AND source = \'user\'' + FAMILY_SQL + ' GROUP BY day').bind(lastWeek, family, family).all()).results || [];
  const use = {now: {fills: 0, required: 0}, before: {fills: 0, required: 0}};
  for (const row of exposure) { const when = period(row.day); if (when) { use[when].fills += row.fills || 0; use[when].required += row.required || 0; } }
  const reasonRows = (await db.prepare('SELECT day, reason, SUM(n) AS n FROM fill_reasons WHERE day >= ? AND source = \'user\'' + FAMILY_SQL + ' GROUP BY day, reason').bind(lastWeek, family, family).all()).results || [];
  const counts = {now: {}, before: {}};
  for (const row of reasonRows) { const when = period(row.day); if (when) counts[when][row.reason] = (counts[when][row.reason] || 0) + row.n; }
  // Per 100 required questions when the apps sent the count, else per 100 forms.
  const per = when => (use[when].required ? {base: use[when].required, unit: 'required questions'} : {base: use[when].fills, unit: 'forms'});
  const per100 = (when, reason) => (per(when).base ? (100 * (counts[when][reason] || 0)) / per(when).base : null);
  const reasons = REASONS.map(([reason, text, group]) => ({reason, text, group, now: counts.now[reason] || 0, before: counts.before[reason] || 0,
    rateNow: per100('now', reason), rateBefore: per100('before', reason)}));

  const recipeRows = (await db.prepare('SELECT status, COUNT(*) AS n, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS fresh FROM recipes GROUP BY status')
    .bind(thisWeek).all()).results || [];
  const recipes = Object.fromEntries(['candidate', 'canary', 'verified', 'disabled'].map(status => {
    const row = recipeRows.find(r => r.status === status);
    return [status, {n: row?.n || 0, fresh: row?.fresh || 0}];
  }));

  // The funnel's first stages: controls the operators missed this week, real use and lab (pool, replays) apart (control_outcomes.source, migration 0070).
  const missRows = (await db.prepare("SELECT source = 'user' AS real, COUNT(DISTINCT CASE WHEN failed > 0 THEN fingerprint END) AS controls, SUM(failed) AS failed, SUM(ok + failed) AS attempts FROM control_outcomes WHERE day >= ? GROUP BY real").bind(thisWeek).all().catch(() => ({results: []}))).results || [];
  const misses = Object.fromEntries([['user', 1], ['lab', 0]].map(([group, real]) => {
    const row = missRows.find(r => r.real === real);
    return [group, {controls: row?.controls || 0, failed: row?.failed || 0, attempts: row?.attempts || 0}];
  }));

  const results = resultsFrom((await db.prepare('SELECT day, board, state, SUM(n) AS n FROM flow_outcomes WHERE day >= ?' + FAMILY_SQL + ' GROUP BY day, board, state').bind(lastWeek, family, family).all().catch(() => ({results: []}))).results || [], thisWeek, lastWeek);
  const learning = await digest(db, now).catch(() => null);
  const marks = await marksCheck(db, thisWeek, family).catch(() => []);   // the star count against the required count, per board (migration 0053)
  const families = await byFamily(db, thisWeek).catch(() => null);
  const answers = await answersByFamily(db, thisWeek, lastWeek).catch(() => null);   // the AI's own answers, per family (migration 0046)
  return {family, families, answers, results, learning, marks,
    use: {...use, unitNow: per('now').unit, reasons}, recipes, misses, leftEmpty: await leftEmpty(db, now, 'real'), bestCase: await slowCache(db, now)('left-empty', () => leftEmpty(db, now, 'lab')).catch(() => null), from: lastWeek, to: day(now)};
}

// The cross-check: forms whose labels carry far more "*" marks than the required rule counted. A board is flagged when it shows at least 3 marks
// and more than twice as many as required questions: the rule missed a layout there (a recorded page and a shape test are due).
export const MARKS_MIN = 3;
export async function marksCheck(db, since, family = '') {
  const rows = (await db.prepare('SELECT board, SUM(n) AS forms, SUM(required) AS required, SUM(starred) AS starred FROM form_exposure WHERE day >= ? AND source = \'user\' AND starred > 0' + FAMILY_SQL + ' GROUP BY board ORDER BY starred DESC LIMIT 30')
    .bind(since, family, family).all()).results || [];
  return rows.map(row => ({board: row.board, forms: row.forms || 0, required: row.required || 0, starred: row.starred || 0,
    blind: (row.starred || 0) >= MARKS_MIN && (row.starred || 0) > 2 * (row.required || 0)}));
}
