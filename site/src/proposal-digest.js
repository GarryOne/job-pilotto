// The digest's "Proposed answers" section: what people did with the answers the app proposed on the session page (proposal_use, from
// desktop/lib/proposal-use.js). Per source and per release: shown, used as proposed, edited, and the rest (ignored). A proposal used as it
// was is the app being right without a code change; the share used per release is how proposals improve from one iteration to the next.
// Guarded by site/test/digest.test.js.
import {SOURCES} from '../../desktop/lib/proposal-use.js';

const share = (top, bottom) => (bottom ? Number((top / bottom).toFixed(3)) : null);
function tally(list) {
  const shown = list.filter(r => r.act === 'shown').reduce((s, r) => s + r.n, 0), used = list.filter(r => r.act === 'used').reduce((s, r) => s + r.n, 0),
    edited = list.filter(r => r.act === 'edited').reduce((s, r) => s + r.n, 0);
  return {shown, used, edited, usedShare: share(used, shown), editedShare: share(edited, shown), ignoredShare: share(Math.max(0, shown - used - edited), shown)};
}
const group = (list, key) => list.reduce((out, r) => ((out[key(r)] ||= []).push(r), out), {});

// rows: proposal_use rows since `from`; weekAgo / twoWeeks: day strings. -> {thisWeek, lastWeek, bySource, byVersion, byFamily}
export function proposalSection(rows, weekAgo, twoWeeks, byVersion) {
  const thisWeek = rows.filter(r => r.day >= weekAgo), lastWeek = rows.filter(r => r.day >= twoWeeks && r.day < weekAgo);
  return {thisWeek: tally(thisWeek), lastWeek: tally(lastWeek),
    bySource: SOURCES.map(source => ({source, now: tally(thisWeek.filter(r => r.source === source)), before: tally(lastWeek.filter(r => r.source === source))}))
      .filter(item => item.now.shown || item.before.shown),
    byVersion: Object.entries(group(rows.filter(r => r.version), r => r.version)).sort(([a], [b]) => byVersion(a, b)).map(([version, list]) => ({version, ...tally(list)})),
    byFamily: Object.entries(group(thisWeek, r => r.ai_family || 'unknown')).map(([family, list]) => ({family, ...tally(list)}))};
}

const pct = value => (value == null ? '–' : `${Math.round(value * 100)}%`);
export function proposalLines(p) {
  if (!p || (!p.thisWeek.shown && !p.lastWeek.shown)) return ['', '## Proposed answers', '', 'None shown yet (counted since app versions with desktop/lib/proposal-use.js).'];
  return ['', '## Proposed answers (used as proposed = right without a code change)', '',
    `**This week:** ${p.thisWeek.shown} shown · used ${pct(p.thisWeek.usedShare)} (last week ${pct(p.lastWeek.usedShare)}) · edited ${pct(p.thisWeek.editedShare)} · ignored ${pct(p.thisWeek.ignoredShare)}.`, '',
    '| Source | Shown | Used | Edited | Ignored | Used last week |', '|---|---|---|---|---|---|',
    ...p.bySource.map(s => `| ${s.source} | ${s.now.shown} | ${pct(s.now.usedShare)} | ${pct(s.now.editedShare)} | ${pct(s.now.ignoredShare)} | ${pct(s.before.usedShare)} |`),
    '', '| Version | Shown | Used | Edited | Ignored |', '|---|---|---|---|---|',
    ...p.byVersion.map(v => `| ${v.version} | ${v.shown} | ${pct(v.usedShare)} | ${pct(v.editedShare)} | ${pct(v.ignoredShare)} |`)];
}

// The same numbers as a card on /admin/form-filling (src/formlearning.js), beside "How applications ended".
export function proposalCard(p, esc) {
  const row = (name, t, before) => `<tr><td>${esc(name)}</td><td class="n">${t.shown}</td><td class="n">${pct(t.usedShare)}</td><td class="n">${pct(t.editedShare)}</td><td class="n">${pct(t.ignoredShare)}</td>${before ? `<td class="n muted">${pct(before.usedShare)}</td>` : '<td></td>'}</tr>`;
  const empty = !p || (!p.thisWeek.shown && !p.lastWeek.shown);
  return `<section class="card"><h2>🎯 Proposed answers: used as proposed</h2><small class="muted">What people did with the answers the app proposed for a field the form left empty. Used as proposed = the app was right, with no code change; the share used per release shows whether proposals improve from one iteration to the next.</small>
<div class="wrap"><table><tr><th>Source</th><th class="n">Shown</th><th class="n">Used</th><th class="n">Edited</th><th class="n">Ignored</th><th class="n">Used last week</th></tr>
${empty ? '<tr><td colspan="6" class="muted">None shown yet: counted from app versions that report proposal use.</td></tr>'
    : [row('All', p.thisWeek, p.lastWeek), ...p.bySource.map(s => row(s.source, s.now, s.before))].join('')}</table></div>
${empty || !p.byVersion.length ? '' : `<div class="wrap"><table><tr><th>Release</th><th class="n">Shown</th><th class="n">Used</th><th class="n">Edited</th><th class="n">Ignored</th><th></th></tr>${p.byVersion.map(v => row(v.version, v)).join('')}</table></div>`}</section>`;
}
