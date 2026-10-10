// The owner's /smart-form-filling page: is the form filling getting better, and is its learning loop working? (Notion: "The
// self-learning loop".) Everything here is already counted for other pages; this one puts it on one timeline, this week vs last:
//   1 real use (the form lab on public forms was retired 9 Oct 2026: it could not see what real fills meet): why fields stayed empty and what people answered themselves, per 100 required questions (form_exposure.required;
//     per 100 forms for apps older than 0.8.96, which send no count)
//   2 the recipe funnel (candidate -> canary -> verified, disabled).
// Counts and the forms' own public wording only. Owner-only, like /self-heal.
import {answersByFamily, answersSection} from './answer-metrics.js';
import {FAMILIES, familyLinks, familyParam} from './engines.js';
import {viewer} from './auth.js';   // admins (invited) read this page too
import {digest, markdown} from './digest.js';
import {proposalCard} from './proposal-digest.js';
import {RESULT_STATES} from '../../desktop/lib/application-result.js';
import {isOwner, esc, remember} from './stats.js';

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
    const use = await db.prepare('SELECT SUM(n) AS fills, SUM(required) AS required FROM form_exposure WHERE day >= ? AND ai_family = ?').bind(thisWeek, family).first().catch(() => null);
    const left = await db.prepare('SELECT SUM(n) AS n FROM fill_reasons WHERE day >= ? AND ai_family = ?').bind(thisWeek, family).first().catch(() => null);
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

  const exposure = (await db.prepare('SELECT day, SUM(n) AS fills, SUM(required) AS required FROM form_exposure WHERE day >= ?' + FAMILY_SQL + ' GROUP BY day').bind(lastWeek, family, family).all()).results || [];
  const use = {now: {fills: 0, required: 0}, before: {fills: 0, required: 0}};
  for (const row of exposure) { const when = period(row.day); if (when) { use[when].fills += row.fills || 0; use[when].required += row.required || 0; } }
  const reasonRows = (await db.prepare('SELECT day, reason, SUM(n) AS n FROM fill_reasons WHERE day >= ?' + FAMILY_SQL + ' GROUP BY day, reason').bind(lastWeek, family, family).all()).results || [];
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

  const results = resultsFrom((await db.prepare('SELECT day, board, state, SUM(n) AS n FROM flow_outcomes WHERE day >= ?' + FAMILY_SQL + ' GROUP BY day, board, state').bind(lastWeek, family, family).all().catch(() => ({results: []}))).results || [], thisWeek, lastWeek);
  const learning = await digest(db, now).catch(() => null);
  const marks = await marksCheck(db, thisWeek, family).catch(() => []);   // the star count against the required count, per board (migration 0053)
  const families = await byFamily(db, thisWeek).catch(() => null);
  const answers = await answersByFamily(db, thisWeek, lastWeek).catch(() => null);   // the AI's own answers, per family (migration 0046)
  return {family, families, answers, results, learning, marks,
    use: {...use, unitNow: per('now').unit, reasons}, recipes, from: lastWeek, to: day(now)};
}

// The cross-check: forms whose labels carry far more "*" marks than the required rule counted. A board is flagged when it shows at least 3 marks
// and more than twice as many as required questions: the rule missed a layout there (a recorded page and a shape test are due).
export const MARKS_MIN = 3;
export async function marksCheck(db, since, family = '') {
  const rows = (await db.prepare('SELECT board, SUM(n) AS forms, SUM(required) AS required, SUM(starred) AS starred FROM form_exposure WHERE day >= ? AND starred > 0' + FAMILY_SQL + ' GROUP BY board ORDER BY starred DESC LIMIT 30')
    .bind(since, family, family).all()).results || [];
  return rows.map(row => ({board: row.board, forms: row.forms || 0, required: row.required || 0, starred: row.starred || 0,
    blind: (row.starred || 0) >= MARKS_MIN && (row.starred || 0) > 2 * (row.required || 0)}));
}

const pct = cell => (cell?.rate == null ? '–' : `${Math.round(cell.rate * 100)}%`);
const num = value => (value == null ? '–' : value < 10 ? value.toFixed(1) : String(Math.round(value)));
// The change, as an arrow that says better or worse (higher is better for rates, lower for misses).
function trend(now, before, higherIsBetter = true) {
  if (now == null || before == null) return '<span class="muted">new</span>';
  const delta = now - before;
  if (Math.abs(delta) < 1e-9) return '<span class="muted">=</span>';
  const good = higherIsBetter ? delta > 0 : delta < 0;
  return `<span class="${good ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'}</span>`;
}

// The "*" cross-check (marksCheck): a board that marks far more labels than the app counted as required is a blind spot of the required rule.
function marksSection(marks) {
  const rows = Array.isArray(marks) ? marks : [];
  const blind = rows.filter(row => row.blind);
  return `<section class="card"><h2>⭐ Required marks: seen vs counted</h2><small class="muted">Labels a form marks with a "*", counted apart from the required rule, against the questions the app counted as required (this week; apps from 0.9.175). ${blind.length ? `<b>${blind.length} board${blind.length === 1 ? '' : 's'} flagged: the rule missed a layout there.</b>` : 'No board flagged.'} Flagged = at least ${MARKS_MIN} marks and more than twice the required count.</small>
<div class="wrap"><table><tr><th>Board</th><th class="n">Forms</th><th class="n">Marks seen</th><th class="n">Counted required</th><th>Verdict</th></tr>
${rows.map(row => `<tr><td>${esc(row.board)}</td><td class="n">${row.forms}</td><td class="n">${row.starred}</td><td class="n">${row.required}</td><td>${row.blind ? '<span class="down">Blind spot: add a recorded page</span>' : 'ok'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No data yet: it starts with extension 0.9.175.</td></tr>'}</table></div></section>`;
}

// From the learning digest (src/digest.js): efficiency day by day from every fill's record, and the top weaknesses.
function learningSections(d) {
  if (!d) return '';
  const p = value => (value == null ? '–' : `${Math.round(value * 100)}%`);
  const days = d.daily.slice(-14).reverse();
  return `<section class="card"><h2>📈 Efficiency, day by day</h2><small class="muted">One anonymous record per fill (apps from 0.8.97). Filled = required questions the fill answered; needing nothing = forms complete with nothing answered by hand.</small>
<div class="wrap"><table><tr><th>Day</th><th class="n">Forms</th><th class="n">Filled</th><th class="n">Needing nothing</th><th class="n">Never read /100</th><th class="n">Submitted</th><th class="n">Median time</th></tr>
${days.map(x => `<tr><td>${esc(x.day)}</td><td class="n">${x.forms}</td><td class="n">${p(x.filledShare)}</td><td class="n">${p(x.formsNeedingNothing)}</td><td class="n">${x.unreadPer100 ?? '–'}</td><td class="n">${p(x.submittedShare)}</td><td class="n">${x.medianSeconds == null ? '–' : `${x.medianSeconds} s`}</td></tr>`).join('')
  || '<tr><td colspan="7" class="muted">No fill records yet: they start with extension 0.8.97.</td></tr>'}</table></div></section>
<section class="card"><h2>🎯 Top weaknesses</h2><small class="muted">Ranked by impact (forms affected × required questions lost). The full digest, with evidence per release, for people and the weekly AI pass:
<a href="/admin/form-filling/digest.md">Markdown</a> · <a href="/admin/form-filling/digest.json">JSON</a></small>
<ol>${d.weaknesses.slice(0, 5).map(w => `<li><b>${esc(w.title)}</b> <span class="muted">· impact ${w.impact} · ${esc(w.area.split(':')[0])}</span></li>`).join('') || '<li class="muted">Nothing ranked yet.</li>'}</ol></section>`;
}

const WORDS = {'submitted-clean': ['✅ Submitted, nothing changed by you', 'the extension filled every required field'], 'submitted-assisted': ['✍️ Submitted, you fixed fields', 'you answered or corrected at least one field'],
  'submitted-claude': ['🤖 Submitted with Claude', 'finished through Apply with Claude'], 'failed-no-form': ['🚫 Failed: no form reached', 'the extension could not get to the form'],
  'failed-account': ['🔐 Failed at sign-in or sign-up', 'a bot check, a code, something only the person could give'], 'failed-abandoned': ['💤 Not submitted', 'the tab closed, the session ended, or the person chose not to']};
function resultsSection(results) {
  if (!results) return '';
  const {now, before} = results, none = !now.finished && !before.finished;
  const row = state => `<tr><td>${WORDS[state][0]}<br><small class="muted">${WORDS[state][1]}</small></td><td class="n">${now[state]}</td><td class="n muted">${before[state]}</td></tr>`;
  return `<section class="card"><h2>🏁 How applications ended</h2><small class="muted">One fixed word per finished application, by the app (counts only, from installs that send technical reports; tests and twins are never counted). Success = submitted ÷ finished.</small>
<div class="tiles"><section class="card tile"><small class="muted">Success rate</small><b>${pct({rate: now.successRate})} ${trend(now.successRate, before.successRate)}</b><small class="muted">${now.submitted} of ${now.finished} finished this week · ${pct({rate: before.successRate})} last week</small></section>
<section class="card tile"><small class="muted">Nothing changed by you</small><b>${pct({rate: now.cleanShare})}</b><small class="muted">of submitted · assisted ${pct({rate: now.assistedShare})}</small></section></div>
<div class="wrap"><table><tr><th>Ended as</th><th class="n">This week</th><th class="n">Last week</th></tr>${RESULT_STATES.map(row).join('')}</table></div>
${none ? '<small class="muted">No finished applications reported yet: they appear once someone decides "I submitted it" or "not submitted".</small>' : `<div class="wrap"><table><tr><th>Board</th><th class="n">Finished</th><th class="n">Submitted</th><th class="n">Assisted</th><th class="n">Failed</th></tr>
${results.boards.map(b => `<tr><td>${esc(b.board)}</td><td class="n">${b.finished}</td><td class="n">${b.submitted}</td><td class="n">${b['submitted-assisted']}</td><td class="n">${b.failed}</td></tr>`).join('')}</table></div>`}</section>`;
}

// This week per AI family, side by side (owner, 9 Oct 2026: Claude users and Codex/OpenAI users told apart).
function familySection(families) {
  if (!families) return '';
  const cell = value => (value === null || value === undefined ? '–' : value);
  const row = (key, label) => {
    const f = families[key];
    return `<tr><td>${label}</td><td class="n">${f.fills}</td><td class="n">${f.finished ? `${pct({rate: f.successRate})} (${f.submitted}/${f.finished})` : '–'}</td><td class="n">${cell(f.leftPer100 === null ? null : num(f.leftPer100))}</td></tr>`;
  };
  return `<section class="card"><h2>🤖 By AI family, this week</h2><small class="muted">From each reporting install's latest health report: Claude = Claude Code or an Anthropic key; OpenAI = Codex or an OpenAI key. Unknown = counted before 9 Oct 2026, or no health report yet.</small>
<div class="scroll"><table><tr><th>Family</th><th>Forms filled</th><th>Success (submitted ÷ finished)</th><th>Fields left empty per 100</th></tr>
${row('claude', 'Claude')}${row('openai', 'OpenAI')}${row('unknown', 'Unknown')}</table></div></section>`;
}

export function page(data, url = new URL('https://www.jobpilotto.top/admin/form-filling')) {
  const w = data.learning?.thisWeek, l = data.learning?.lastWeek;   // real fills (fill_cards, the digest)
  // Compared with last week; while last week has no forms, the last 3 days against the days before (the digest's recent vs earlier window).
  const early = !l?.forms && data.learning?.recent, rc = data.learning?.recent, er = data.learning?.earlier;
  const f = early ? (rc?.filledShare == null ? null : {now: rc.filledShare, before: er?.filledShare ?? null, words: 'last 3 days vs the days before'})
    : w?.filledShare == null ? null : {now: w.filledShare, before: l?.filledShare ?? null, words: 'this week vs last'};
  const blind = data.use.reasons.filter(x => x.group === 'blind spot');
  const blindNow = blind.reduce((s, x) => s + (x.rateNow || 0), 0), blindBefore = blind.reduce((s, x) => s + (x.rateBefore || 0), 0);
  const haveUse = data.use.now.fills || data.use.before.fills;
  const tile = (title, value, change, note) => `<section class="card tile"><small class="muted">${title}</small><b>${value} ${change}</b><small class="muted">${note}</small></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Form filling · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--good:#3fb68b;--bad:#e5484d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 48px}h1{margin:0;font-size:24px}h2{margin:0;font-size:15px}
a{color:var(--amber)}.muted{color:var(--muted)}header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0;margin-bottom:12px}.tile{margin-bottom:0}
.tile b{display:block;font-size:30px;margin:4px 0 2px}.up{color:var(--good)}.down{color:var(--bad)}
.wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;margin-top:8px}th{text-align:left;font-weight:500;color:var(--muted);font-size:12px;padding:6px 4px}
td{padding:6px 4px;border-top:1px solid var(--line)}th.n{text-align:right}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
</style></head><body><main>
<header><h1>📝 Form filling</h1><span class="muted">${esc(data.from)} → ${esc(data.to)} · this week vs last${data.family ? ` · ${esc(FAMILIES[data.family])} installs only` : ''}</span></header>
${familyLinks(url, data.family || '')}
${familySection(data.families)}
${answersSection(data.answers, trend)}
<div class="tiles">
${tile('✅ Filled (real use)', f ? `${Math.round(f.now * 100)}%` : '–', f ? trend(f.now, f.before) : '', `required questions the fill answered · ${f?.words || 'this week vs last'}: ${f?.before == null ? '–' : `${Math.round(f.before * 100)}%`} before · ${data.learning?.thisWeek?.forms || 0} forms this week`)}
${tile('🕳️ Blind spots (real use)', haveUse ? num(blindNow) : '–', haveUse ? trend(blindNow, blindBefore, false) : '', `per 100 ${esc(data.use.unitNow)}: questions the fill never read · ${data.use.now.fills} forms this week`)}
${tile('🧩 Recipes', String(data.recipes.verified.n), `<span class="muted">+${data.recipes.canary.n} canary</span>`, `verified · ${data.recipes.candidate.n} candidates (${data.recipes.candidate.fresh} new this week) · ${data.recipes.disabled.n} retired`)}
</div>
${resultsSection(data.results)}
${proposalCard(data.learning?.proposals, esc)}
${learningSections(data.learning)}
${marksSection(data.marks)}
<section class="card"><h2>🧭 Real use: what the fill missed</h2><small class="muted">From the apps that send technical reports, per 100 ${esc(data.use.unitNow)}. Blind spots are what the learning loop must catch; widgets get recipes; data is the profile's. Per platform, against the pool's tests: <a href="/admin/applying">Applying tests → platform scorecard</a>.</small>
<div class="wrap"><table><tr><th>Why</th><th>Kind</th><th class="n">This week</th><th class="n">Per 100</th><th></th><th class="n">Last week</th></tr>
${data.use.reasons.filter(x => x.now || x.before).map(x => `<tr><td>${esc(x.text)}</td><td class="muted">${esc(x.group)}</td><td class="n">${x.now}</td><td class="n">${num(x.rateNow)}</td><td>${trend(x.rateNow, x.rateBefore, false)}</td><td class="n muted">${num(x.rateBefore)}</td></tr>`).join('')
  || '<tr><td colspan="6" class="muted">Nothing reported yet.</td></tr>'}</table></div></section>
<section class="card"><h2>🧩 Recipe funnel</h2><small class="muted">Learned fixes for widgets, as data: proposed by a small model, rolled out by canary.</small>
<table><tr><th class="n">Candidate</th><th class="n">Canary</th><th class="n">Verified</th><th class="n">Retired</th></tr><tr>${['candidate', 'canary', 'verified', 'disabled'].map(s => `<td class="n">${data.recipes[s].n}${data.recipes[s].fresh ? ` <span class="muted">(+${data.recipes[s].fresh})</span>` : ''}</td>`).join('')}</tr></table></section>
</main></body></html>`;
}

// GET /admin/form-filling/digest.json | .md: the learning digest (any admin, or the scripts' key for the weekly AI pass).
export async function digestView(request, env, now = new Date()) {
  if (!await viewer(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const d = await digest(env.STATS, now);
  if (new URL(request.url).pathname.endsWith('.md')) return new Response(markdown(d), {headers: {'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
  return Response.json(d, {headers: {'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}

export async function view(request, env, now = new Date()) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('key')) return remember(url, env, request);
  if (!env.STATS) return new Response('No database', {status: 503});
  const family = familyParam(url);   // ?family=claude|openai: every count of the page for that AI family (src/engines.js)
  return new Response(page(await report(env.STATS, now, family), url), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'}});
}
