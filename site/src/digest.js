// The form-filling learning digest: how well the filling does, day by day and per release, and its weaknesses ranked by impact,
// each with its evidence and the area a fix belongs to. Built from what the site keeps (fill_cards, control_outcomes,
// control_samples, question_labels): counts, fixed words and the forms' own public wording only. Served as JSON and Markdown on
// /admin/form-filling/digest.json|.md (any admin; the scripts' key too), read by the weekly LLM pass in the private repo
// (digest/propose.mjs) that turns the top weaknesses into proposals. Design: Notion "The self-learning loop".

import {proposalLines, proposalSection} from './proposal-digest.js';

const DAY = 86400000;
const dayOf = date => date.toISOString().slice(0, 10);
const json = text => { try { return JSON.parse(text) || {}; } catch { return {}; } };
const rows = async (db, sql, ...binds) => { try { return (await db.prepare(sql).bind(...binds).all()).results || []; } catch { return []; } };
const share = (top, bottom) => (bottom ? top / bottom : null);
const round = (value, places = 3) => (value == null ? null : Number(value.toFixed(places)));
// "0.8.96" < "0.8.100": versions compared part by part.
export const byVersion = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 4; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

// Where a fix for each cause belongs (what the LLM pass and a person look at first).
export const AREA = {
  unread: 'reader: the extension did not read the question (code: extension/page/fill.js, coverage.js)',
  by_you_unread: 'reader: people answered questions the extension never read (code: extension/page/fill.js)',
  no_data: 'data: neither the kit nor the profile has an answer (profile fields, kit drafting, label aliases)',
  proposed: 'person: the AI proposed an answer, shown to confirm and never typed (not a loss of the fill)',
  ai_declined: 'AI: Claude was asked and gave no answer (the answer prompt, the context it gets)',
  ai_unsure: 'AI: Claude answered with low confidence (the answer prompt, the profile facts it gets)',
  ai_off: 'AI availability: Claude was not asked (eligibility stop, answering off)',
  ai_error: 'AI availability: the call failed (relay, budget, errors)',
  not_taken: 'operator: the field did not keep the value (extension/page/fill.js setters, recipes)',
  menu_not_clicked: 'availability: no trusted click reached the menu (the setting, the debugger attach)',
  menu_not_opened: 'operator: the menu did not open on the click (extension/page/fill-menus.js, recipes for the widget)',
  menu_not_selected: 'operator: the option was clicked but the field stayed empty (extension/page/menu-pick.js, recipes)',
  menu_not_read: 'reader: the widget holds the choice but the reader cannot see it (extension/page/fill-labels.js comboValue)',
  real_click: 'unknown: a menu left empty by a version that did not observe why (older than 0.9.131)',
  no_option: 'operator: the dropdown has no matching option (option matching, aliases)',
  by_you: 'gap: people answered questions the fill left (any of the above)',
  page_error: 'validation: the page refused the answers after Submit (formats, required checks)',
  other: 'unknown: an unclassified reason (add a cause in extension/fill-card.js)',
  widget: 'operator: a widget the operators could not set (recipes: the proposer)',
  wording: 'data: a question no answer matched, in its own words (profile fields, aliases)',
};

function summarize(cards) {
  const required = cards.reduce((s, c) => s + c.required, 0), filled = cards.reduce((s, c) => s + c.filled, 0);
  const clean = cards.filter(c => c.left_n === 0 && !c.by_you && !c.by_you_unread).length;
  const unread = cards.reduce((s, c) => s + c.unread + c.by_you_unread, 0);
  // Required questions the AI proposed an answer for (to confirm, never typed): apart from filled and from truly missing (9 Oct 2026).
  const proposed = cards.reduce((s, c) => s + (c.causes?.proposed || 0), 0);
  return {forms: cards.length, required, filled, filledShare: round(share(filled, required)), proposed, proposedShare: round(share(proposed, required)),
    missingShare: round(share(Math.max(0, required - filled - proposed), required)), formsNeedingNothing: round(share(clean, cards.length)),
    submittedShare: round(share(cards.filter(c => c.submitted).length, cards.length)), unreadPer100: round(required ? (100 * unread) / required : null, 1),
    medianSeconds: cards.length ? [...cards.map(c => c.seconds)].sort((a, b) => a - b)[Math.floor(cards.length / 2)] : null};
}

export async function digest(db, now = new Date()) {
  const today = dayOf(now), weekAgo = dayOf(new Date(now.getTime() - 6 * DAY)), twoWeeks = dayOf(new Date(now.getTime() - 13 * DAY)), month = dayOf(new Date(now.getTime() - 27 * DAY));
  const cards = (await rows(db, 'SELECT * FROM fill_cards WHERE day >= ?', month)).map(c => ({...c, causes: json(c.causes), kinds: json(c.kinds)}));
  const thisWeek = cards.filter(c => c.day >= weekAgo), lastWeek = cards.filter(c => c.day >= twoWeeks && c.day < weekAgo);
  const group = (list, key) => list.reduce((out, c) => ((out[key(c)] ||= []).push(c), out), {});
  const daily = Object.entries(group(cards, c => c.day)).sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => ({day, ...summarize(list)}));
  const versions = Object.entries(group(cards.filter(c => c.version), c => c.version)).filter(([, list]) => list.length >= 3)
    .sort(([a], [b]) => byVersion(a, b)).map(([version, list]) => ({version, ...summarize(list)}));
  const boards = Object.entries(group(thisWeek, c => c.board)).map(([board, list]) => ({board, ...summarize(list)})).sort((a, b) => b.forms - a.forms);

  // Recent vs earlier (mac-1a, 9 Oct 2026): the last 3 days against the 4 before them, inside this week. Weekly and per-release rows are too thin
  // to show progress while fills are few and versions change hourly; this window moves within days.
  const recentFrom = dayOf(new Date(now.getTime() - 2 * DAY));
  const recent = thisWeek.filter(c => c.day >= recentFrom), earlier = thisWeek.filter(c => c.day < recentFrom);
  const per100 = (list, cause) => { const required = list.reduce((s, c) => s + c.required, 0); return round(required ? (100 * lost(list, cause)) / required : null, 1); };
  const weaknesses = [];
  // 1. Why required questions stayed empty, per cause and board (and what people answered themselves), with the per-release rate.
  const lost = (list, cause) => list.reduce((s, c) => s + (cause === 'by_you' ? c.by_you : cause === 'by_you_unread' ? c.by_you_unread : cause === 'page_error' ? c.page_error : c.causes[cause] || 0), 0);
  const causes = [...new Set([...cards.flatMap(c => Object.keys(c.causes)), 'by_you', 'by_you_unread', 'page_error'])];
  for (const cause of causes.filter(cause => cause !== 'proposed')) {   // a proposal waits for the person: shown in the totals, not a weakness
    for (const [board, list] of Object.entries(group(thisWeek, c => c.board))) {
      const n = lost(list, cause), forms = list.filter(c => lost([c], cause) > 0).length;
      if (!n) continue;
      const before = lastWeek.filter(c => c.board === board), required = list.reduce((s, c) => s + c.required, 0);
      weaknesses.push({id: `cause:${cause}:${board}`, kind: 'cause', cause, board, area: AREA[cause] || AREA.other, impact: forms * n,
        title: `${cause} on ${board}: ${n} required question${n === 1 ? '' : 's'} on ${forms} of ${list.length} forms`,
        now: {lost: n, forms, per100: round(required ? (100 * n) / required : null, 1)},
        before: {lost: lost(before, cause), forms: before.length},
        recent: {per100: per100(recent.filter(c => c.board === board), cause), forms: recent.filter(c => c.board === board).length},
        earlier: {per100: per100(earlier.filter(c => c.board === board), cause), forms: earlier.filter(c => c.board === board).length},
        kinds: list.reduce((out, c) => { if (lost([c], cause)) for (const [k, v] of Object.entries(c.kinds)) out[k] = (out[k] || 0) + v; return out; }, {}),
        byVersion: Object.entries(group(cards.filter(c => c.board === board && c.version), c => c.version)).sort(([a], [b]) => byVersion(a, b))
          .map(([version, vl]) => ({version, forms: vl.length, per100: round(vl.reduce((s, c) => s + c.required, 0) ? (100 * lost(vl, cause)) / vl.reduce((s, c) => s + c.required, 0) : null, 1)}))});
    }
  }
  // 2. Widgets the operators could not set for users (a recipe's job). The form lab was retired 9 Oct 2026.
  for (const row of await rows(db, `SELECT o.fingerprint, SUM(o.failed) AS failed, SUM(o.ok) AS ok,
      (SELECT kind FROM control_samples s WHERE s.fingerprint = o.fingerprint LIMIT 1) AS kind,
      (SELECT question FROM control_samples s WHERE s.fingerprint = o.fingerprint LIMIT 1) AS question
    FROM control_outcomes o WHERE o.day >= ? GROUP BY o.fingerprint HAVING SUM(o.failed) > 0 ORDER BY failed DESC LIMIT 15`, weekAgo)) {
    weaknesses.push({id: `widget:${row.fingerprint}`, kind: 'widget', cause: 'widget', area: AREA.widget, impact: row.failed,
      title: `A ${row.kind || 'widget'} failed ${row.failed} time${row.failed === 1 ? '' : 's'} (${row.ok} worked)`, now: {failed: row.failed, ok: row.ok},
      evidence: {fingerprint: row.fingerprint, kind: row.kind || '', question: row.question || ''}});
  }
  // 3. Questions no answer matched, in the forms' own words, once 3+ installs met them (question_labels keeps only those).
  for (const row of await rows(db, 'SELECT label, kind, n, boards FROM question_labels WHERE last_day >= ? ORDER BY n DESC LIMIT 15', weekAgo)) {
    weaknesses.push({id: `wording:${row.label}`, kind: 'wording', cause: 'no_data', area: AREA.wording, impact: row.n,
      title: `No answer matched "${row.label}"`, now: {times: row.n}, evidence: {label: row.label, kind: row.kind, boards: json(row.boards)}});
  }
  weaknesses.sort((a, b) => b.impact - a.impact);
  const proposals = proposalSection(await rows(db, 'SELECT * FROM proposal_use WHERE day >= ?', month), weekAgo, twoWeeks, byVersion);
  return {generated: now.toISOString(), period: {from: weekAgo, to: today, compare: twoWeeks}, thisWeek: summarize(thisWeek), lastWeek: summarize(lastWeek),
    recent: {from: recentFrom, ...summarize(recent)}, earlier: summarize(earlier),
    daily, versions, boards, proposals, weaknesses: weaknesses.slice(0, 25),
    notes: ['Counts and fixed words only; question wording is the forms\' own, kept once 3+ installs reported it.',
      'impact = forms affected x required questions lost (widgets: failures; wording: times met).',
      'filledShare = required questions the fill answered / required questions; formsNeedingNothing = forms left complete with nothing answered by hand.']};
}

const pct = value => (value == null ? '–' : `${Math.round(value * 100)}%`);
export function markdown(d) {
  const t = d.thisWeek, l = d.lastWeek;
  const lines = [`# Form-filling learning digest, ${d.period.from} → ${d.period.to}`, '',
    `**This week:** ${t.forms} forms · required questions filled ${pct(t.filledShare)} (last week ${pct(l.filledShare)}) · proposed to confirm ${pct(t.proposedShare)} (${pct(l.proposedShare)}) · truly missing ${pct(t.missingShare)} (${pct(l.missingShare)}) · forms needing nothing from the person ${pct(t.formsNeedingNothing)} (${pct(l.formsNeedingNothing)}) · questions never read per 100 required ${t.unreadPer100 ?? '–'} (${l.unreadPer100 ?? '–'}) · submitted ${pct(t.submittedShare)}.`, '',
    `**Recent vs earlier** (since ${d.recent.from} vs the days before, this week): ${d.recent.forms} vs ${d.earlier.forms} forms · filled ${pct(d.recent.filledShare)} vs ${pct(d.earlier.filledShare)} · proposed ${pct(d.recent.proposedShare)} vs ${pct(d.earlier.proposedShare)} · truly missing ${pct(d.recent.missingShare)} vs ${pct(d.earlier.missingShare)}.`, '',
    '## Top weaknesses (by impact)', ''];
  d.weaknesses.forEach((w, i) => {
    lines.push(`${i + 1}. **${w.title}** · impact ${w.impact} · id \`${w.id}\``, `   - area: ${w.area}`);
    if (w.now) lines.push(`   - this week: ${JSON.stringify(w.now)}${w.before ? ` · last week: ${JSON.stringify(w.before)}` : ''}`);
    if (w.recent) lines.push(`   - recent vs earlier (per 100 required): ${w.recent.per100 ?? '–'} (${w.recent.forms} forms) vs ${w.earlier.per100 ?? '–'} (${w.earlier.forms} forms)`);
    if (w.kinds && Object.keys(w.kinds).length) lines.push(`   - field kinds: ${JSON.stringify(w.kinds)}`);
    if (w.byVersion?.length) lines.push(`   - per release (per 100 required): ${w.byVersion.map(v => `${v.version}: ${v.per100 ?? '–'} (${v.forms} forms)`).join(', ')}`);
    if (w.evidence) lines.push(`   - evidence: ${JSON.stringify(w.evidence)}`);
  });
  lines.push('', '## Per release', '', '| Version | Forms | Filled | Proposed | Missing | Needing nothing | Never read /100 |', '|---|---|---|---|---|---|---|',
    ...d.versions.map(v => `| ${v.version} | ${v.forms} | ${pct(v.filledShare)} | ${pct(v.proposedShare)} | ${pct(v.missingShare)} | ${pct(v.formsNeedingNothing)} | ${v.unreadPer100 ?? '–'} |`),
    '', '## Per board (this week)', '', '| Board | Forms | Filled | Needing nothing |', '|---|---|---|---|',
    ...d.boards.map(b => `| ${b.board} | ${b.forms} | ${pct(b.filledShare)} | ${pct(b.formsNeedingNothing)} |`),
    '', '## Day by day', '', '| Day | Forms | Filled | Proposed | Missing | Needing nothing | Submitted |', '|---|---|---|---|---|---|---|',
    ...d.daily.map(x => `| ${x.day} | ${x.forms} | ${pct(x.filledShare)} | ${pct(x.proposedShare)} | ${pct(x.missingShare)} | ${pct(x.formsNeedingNothing)} | ${pct(x.submittedShare)} |`),
    ...proposalLines(d.proposals),
    '', ...d.notes.map(n => `> ${n}`));
  return lines.join('\n');
}
