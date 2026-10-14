// The sections the form-filling pages are built from, and the arrows and numbers they share (the data: src/formlearning.js; the thin-data rule: src/thin-data.js). Guard: site/test/thin-data.test.js.
import {RESULT_STATES} from '../../desktop/lib/application-result.js';
import {MARKS_MIN} from './formlearning.js';
import {esc} from './stats.js';
import {gate, isThin, thinWords} from './thin-data.js';

export const pct = cell => (cell?.rate == null ? '–' : `${Math.round(cell.rate * 100)}%`);
export const num = value => (value == null ? '–' : value < 10 ? value.toFixed(1) : String(Math.round(value)));
// The change, as an arrow that says better or worse (higher is better for rates, lower for misses).
export function trend(now, before, higherIsBetter = true) {
  if (now == null || before == null) return '<span class="muted">new</span>';
  const delta = now - before;
  if (Math.abs(delta) < 1e-9) return '<span class="muted">=</span>';
  const good = higherIsBetter ? delta > 0 : delta < 0;
  return `<span class="${good ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'}</span>`;
}

// The "*" cross-check (marksCheck): a board that marks far more labels than the app counted as required is a blind spot of the required rule.
export function marksSection(marks) {
  const rows = Array.isArray(marks) ? marks : [];
  const blind = rows.filter(row => row.blind);
  return `<section class="card"><h2>⭐ Required marks: seen vs counted</h2><small class="muted">Labels a form marks with a "*", counted apart from the required rule, against the questions the app counted as required (this week; apps from 0.9.175). ${blind.length ? `<b>${blind.length} board${blind.length === 1 ? '' : 's'} flagged: the rule missed a layout there.</b>` : 'No board flagged.'} Flagged = at least ${MARKS_MIN} marks and more than twice the required count.</small>
<div class="wrap"><table><tr><th>Board</th><th class="n">Forms</th><th class="n">Marks seen</th><th class="n">Counted required</th><th>Verdict</th></tr>
${rows.map(row => `<tr><td>${esc(row.board)}</td><td class="n">${row.forms}</td><td class="n">${row.starred}</td><td class="n">${row.required}</td><td>${row.blind ? '<span class="down">Blind spot: add a recorded page</span>' : 'ok'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No data yet: it starts with extension 0.9.175.</td></tr>'}</table></div></section>`;
}

// From the learning digest (src/digest.js): efficiency day by day from every fill's record, and the top weaknesses.
export function efficiencySection(d) {
  if (!d) return '';
  const sample = d.sample, p = value => gate(sample, value, v => (v == null ? '–' : `${Math.round(v * 100)}%`));
  const thin = isThin(sample);
  const days = d.daily.slice(-14).reverse();
  return `<section class="card"><h2>📈 Efficiency, day by day</h2><small class="muted">One anonymous record per fill (apps from 0.8.97). Filled = required questions the fill answered; needing nothing = forms complete with nothing answered by hand.</small>
<div class="wrap"><table><tr><th>Day</th><th class="n">Forms</th><th class="n">Filled</th><th class="n">Needing nothing</th><th class="n">Never read /100</th><th class="n">Submitted</th><th class="n">Median time</th></tr>
${days.map(x => `<tr><td>${esc(x.day)}</td><td class="n">${x.forms}</td><td class="n">${p(x.filledShare)}</td><td class="n">${p(x.formsNeedingNothing)}</td><td class="n">${gate(sample, x.unreadPer100, v => v ?? '–')}</td><td class="n">${p(x.submittedShare)}</td><td class="n">${x.medianSeconds == null ? '–' : `${x.medianSeconds} s`}</td></tr>`).join('')
  || '<tr><td colspan="7" class="muted">No fill records yet: they start with extension 0.8.97.</td></tr>'}</table></div></section>`;
}

// The top weaknesses, ranked by impact; "too few to judge" while under 3 installs reported (src/thin-data.js).
export function weaknessesSection(d) {
  if (!d) return '';
  const sample = d.sample, thin = isThin(sample);
  return `<section class="card"><h2>🎯 Top weaknesses</h2><small class="muted">Ranked by impact (forms affected × required questions lost). The full digest, with evidence per release, for people and the weekly AI pass:
<a href="/admin/real-form-filling/digest.md">Markdown</a> · <a href="/admin/real-form-filling/digest.json">JSON</a></small>
${thin ? `<p><b>${esc(thinWords(sample))}.</b> <span class="muted">Not ranked; ${d.thisWeek.forms} forms · ${d.thisWeek.required} required questions this week.</span></p>`
  : `<ol>${d.weaknesses.slice(0, 5).map(w => `<li><b>${esc(w.title)}</b> <span class="muted">· impact ${w.impact} · ${esc(w.area.split(':')[0])}</span></li>`).join('') || '<li class="muted">Nothing ranked yet.</li>'}</ol>`}</section>`;
}

const WORDS = {'submitted-clean': ['✅ Submitted, nothing changed by you', 'the extension filled every required field'], 'submitted-assisted': ['✍️ Submitted, you fixed fields', 'you answered or corrected at least one field'],
  'submitted-claude': ['🤖 Submitted with Claude', 'finished through Apply with Claude'], 'failed-no-form': ['🚫 Failed: no form reached', 'the extension could not get to the form'],
  'failed-account': ['🔐 Failed at sign-in or sign-up', 'a bot check, a code, something only the person could give'], 'failed-abandoned': ['💤 Not submitted', 'the tab closed, the session ended, or the person chose not to']};
export function resultsSection(results) {
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
export function familySection(families, sample) {
  if (!families) return '';
  const cell = value => (value === null || value === undefined ? '–' : value);
  const row = (key, label) => {
    const f = families[key];
    return `<tr><td>${label}</td><td class="n">${f.fills}</td><td class="n">${f.finished ? `${pct({rate: f.successRate})} (${f.submitted}/${f.finished})` : '–'}</td><td class="n">${cell(f.leftPer100 === null || isThin(sample) ? null : num(f.leftPer100))}</td></tr>`;
  };
  return `<section class="card"><h2>🤖 By AI family, this week</h2><small class="muted">From each reporting install's latest health report: Claude = Claude Code or an Anthropic key; OpenAI = Codex or an OpenAI key. Unknown = counted before 9 Oct 2026, or no health report yet.</small>
<div class="scroll"><table><tr><th>Family</th><th>Forms filled</th><th>Success (submitted ÷ finished)</th><th>Fields left empty per 100</th></tr>
${row('claude', 'Claude')}${row('openai', 'OpenAI')}${row('unknown', 'Unknown')}</table></div></section>`;
}

// The Filled and Blind-spots headline tiles of real use (the digest's fill cards; form_exposure for the blind spots), "too few" under 3 installs.
export const tile = (title, value, change, note) => `<section class="card tile"><small class="muted">${title}</small><b>${value} ${change}</b><small class="muted">${note}</small></section>`;
export function realTiles(data) {
  const w = data.learning?.thisWeek, l = data.learning?.lastWeek;   // real fills (fill_cards, the digest)
  // Compared with last week; while last week has no forms, the last 3 days against the days before (the digest's recent vs earlier window).
  const early = !l?.forms && data.learning?.recent, rc = data.learning?.recent, er = data.learning?.earlier;
  const f = early ? (rc?.filledShare == null ? null : {now: rc.filledShare, before: er?.filledShare ?? null, words: 'last 3 days vs the days before'})
    : w?.filledShare == null ? null : {now: w.filledShare, before: l?.filledShare ?? null, words: 'this week vs last'};
  const blind = data.use.reasons.filter(x => x.group === 'blind spot');
  const blindNow = blind.reduce((s, x) => s + (x.rateNow || 0), 0), blindBefore = blind.reduce((s, x) => s + (x.rateBefore || 0), 0);
  const sample = data.learning?.sample, thin = isThin(sample);
  const haveUse = (data.use.now.fills || data.use.before.fills) && !thin;
  return `<div class="tiles">
${thin ? tile('✅ Filled (real use)', 'Too few', '', esc(thinWords(sample))) : tile('✅ Filled (real use)', f ? `${Math.round(f.now * 100)}%` : '–', f ? trend(f.now, f.before) : '', `required questions the fill answered · ${f?.words || 'this week vs last'}: ${f?.before == null ? '–' : `${Math.round(f.before * 100)}%`} before · ${data.learning?.thisWeek?.forms || 0} forms this week`)}
${tile('🕳️ Blind spots (real use)', thin ? 'Too few' : haveUse ? num(blindNow) : '–', haveUse ? trend(blindNow, blindBefore, false) : '', thin ? `${esc(thinWords(sample))} · ${data.use.now.fills} forms reported` : `per 100 ${esc(data.use.unitNow)}: questions the fill never read · ${data.use.now.fills} forms this week`)}
</div>`;
}

// What the fill missed in real use, per 100 required questions (form_exposure and fill_reasons, source 'user'); the per-platform link goes to the Lab page's scorecard.
export function realUseSection(data) {
  const sample = data.learning?.sample, thin = isThin(sample);
  return `<section class="card"><h2>🧭 Real use: what the fill missed</h2><small class="muted">From the apps that send technical reports, per 100 ${esc(data.use.unitNow)}. Blind spots are what the learning loop must catch; widgets get recipes; data is the profile's. ${thin ? `<b>${esc(thinWords(sample))}:</b> counts only, no rate. ` : ''}Per platform, against the pool's tests: <a href="/admin/lab-form-filling">Lab Form Filling → platform scorecard</a>.</small>
<div class="wrap"><table><tr><th>Why</th><th>Kind</th><th class="n">This week</th><th class="n">Per 100</th><th></th><th class="n">Last week</th></tr>
${data.use.reasons.filter(x => x.now || x.before).map(x => `<tr><td>${esc(x.text)}</td><td class="muted">${esc(x.group)}</td><td class="n">${x.now}</td><td class="n">${thin ? '–' : num(x.rateNow)}</td><td>${thin ? '' : trend(x.rateNow, x.rateBefore, false)}</td><td class="n muted">${thin ? '–' : num(x.rateBefore)}</td></tr>`).join('')
  || '<tr><td colspan="6" class="muted">Nothing reported yet.</td></tr>'}</table></div></section>`;
}

// The learned-fix funnel and its headline tile (Form Learning).
export const recipesTile = data => tile('🧩 Recipes', String(data.recipes.verified.n), `<span class="muted">+${data.recipes.canary.n} canary</span>`, `verified · ${data.recipes.candidate.n} candidates (${data.recipes.candidate.fresh} new this week) · ${data.recipes.disabled.n} retired`);
export const funnelSection = data => `<section class="card"><h2>🧩 Recipe funnel</h2><small class="muted">Learned fixes for widgets, as data: proposed by a small model, rolled out by canary. Judged on real use only; the lab (pool, replays) is shown apart.</small>
<table><tr><th>This week</th><th class="n">Controls that failed</th><th class="n">Failed</th><th class="n">Attempts</th></tr>${[['Real use', 'user'], ['Lab', 'lab']].map(([name, group]) => `<tr><td>${name}</td><td class="n">${data.misses?.[group]?.controls ?? 0}</td><td class="n">${data.misses?.[group]?.failed ?? 0}</td><td class="n">${data.misses?.[group]?.attempts ?? 0}</td></tr>`).join('')}</table>
<table><tr><th class="n">Candidate</th><th class="n">Canary</th><th class="n">Verified</th><th class="n">Retired</th></tr><tr>${['candidate', 'canary', 'verified', 'disabled'].map(s => `<td class="n">${data.recipes[s].n}${data.recipes[s].fresh ? ` <span class="muted">(+${data.recipes[s].fresh})</span>` : ''}</td>`).join('')}</tr></table></section>`;
