// /admin/lab-form-filling's recorded cases section, "Page cases" (owner, 12 Oct 2026, via job-pilotto-cc: the old title "every fixed site, replayed" overclaimed): CI on main's
// replays of every recorded case (src/applying-replays.js), each case one mechanism on a small page with a stubbed AI answer, with its origin (captured from a real page or hand-cut),
// search, filters, sorting and pages. A case never says a site works: a fix is "Confirmed offline" on the Fixed tab, from the row's recording.
// src/applying.js puts CASES_SCRIPT inside its page, where it uses that page's el, heads, dots, ago, pick, sortRows, caseMatches and runsScore. Guard: test/applying-replays.test.js, test/applying-fixed.test.js.
export const CASES_SCRIPT = `  // The replays of CI on main after each merge (src/applying-replays.js): every row says the build's sha and when it ran; a local run is never shown.
  const caseBox = el('div'), CASE_GET = [c => c.name.toLowerCase(), c => c.rung, c => c.origin || '', c => (c.ok ? 1 : 0), c => runsScore(c.history, run => run === 1), c => c.at, c => c.since.at];
  const CASE_COLS = ['c-case', 'c-rung', 'c-origin', 'c-result', 'c-runs', 'c-last', 'c-since'];   // widths: .fit th.c-* (the note keeps to 2 lines, the rest on hover: never a sideways scroll)
  const COMMIT = 'https://github.com/GarryOne/job-pilotto/commit/', shaLink = (sha, at) => el('span', {}, el('a', {className: 'hash', href: COMMIT + sha, textContent: sha.slice(0, 7)}), el('span', {className: 'stack', textContent: ago(at)}));
  // Search, Result and Rung filters, sorting and 15 rows a page: the pool table's parts (owner, 12 Oct 2026: "just like other tables on the page").
  const CASE_PER = 15, caseChosen = {result: null, rung: null, origin: null, query: '', page: 0}, caseTable = el('div'), caseCount = el('span', {className: 'muted count'}), casePager = el('div', {className: 'pager'});
  const caseGroups = (get, label) => Object.entries(d.cases.reduce((out, c) => ((out[get(c)] = (out[get(c)] || 0) + 1), out), {})).sort(([a], [b]) => a.localeCompare(b)).map(([name, sites]) => ({name, sites, label: label(name)}));
  const caseRung = c => (c.rung == null ? 'none' : String(c.rung)), caseResult = c => (c.ok ? 'passed' : 'failed'), caseOrigin = c => c.origin || 'unknown';
  const ORIGIN_WORD = {captured: 'Captured from a real page', 'hand-cut': 'Hand-cut', unknown: 'Origin not said'}, originCount = name => d.cases.filter(c => caseOrigin(c) === name).length;
  const caseSearch = el('input', {type: 'search', placeholder: 'Case, result, note or rung', 'aria-label': 'Search the replays', autocomplete: 'off', oninput: event => { caseChosen.query = event.target.value; caseChosen.page = 0; drawCases(); }});
  const caseClear = el('button', {className: 'chip', type: 'button', textContent: 'Clear', hidden: true, onclick: () => { caseChosen.result = caseChosen.rung = caseChosen.origin = null; caseChosen.query = ''; caseChosen.page = 0; caseFilters.querySelectorAll('select').forEach(node => { node.value = ''; }); resetChips(caseFilters); caseSearch.value = ''; drawCases(); }});
  const caseHead = el('p', {className: 'muted'}), caseOptions = {state: caseChosen, redraw: () => drawCases(), unit: 'case'};
  const caseFilters = el('div', {className: 'filters'}, el('label', {className: 'pick search'}, el('span', {className: 'muted', textContent: 'Search'}), caseSearch),
    pick('result', caseGroups(caseResult, name => name[0].toUpperCase() + name.slice(1)), 'Result', 'All results · ' + d.cases.length + ' cases', caseOptions),
    pick('rung', caseGroups(caseRung, name => (name === 'none' ? 'No rung' : 'Rung ' + name)), 'Rung guarded', 'All rungs', caseOptions),
    pick('origin', caseGroups(caseOrigin, name => ORIGIN_WORD[name] || name), 'Origin', originCount('captured') + ' captured · ' + originCount('hand-cut') + ' hand-cut', caseOptions), caseCount, caseClear, casePager);
  caseBox.append(caseHead, caseFilters, caseTable);
  const drawCases = () => { const last = d.cases[0]; caseHead.textContent = last ? 'CI on main, after the merge of ' + last.sha.slice(0, 7) + ' (' + ago(last.at) + (last.version ? ', extension ' + last.version : '') + '): every recorded case replayed on that build. Local runs are not shown.' : '';
    const rows = sortRows('cases', d.cases.filter(c => (!caseChosen.result || caseResult(c) === caseChosen.result) && (!caseChosen.rung || caseRung(c) === caseChosen.rung) && (!caseChosen.origin || caseOrigin(c) === caseChosen.origin) && caseMatches(c, caseChosen.query)), CASE_GET), pages = Math.max(1, Math.ceil(rows.length / CASE_PER));
    caseChosen.page = Math.min(caseChosen.page, pages - 1); const from = caseChosen.page * CASE_PER, shown = rows.slice(from, from + CASE_PER);
    caseCount.textContent = 'Showing ' + (rows.length ? from + 1 : 0) + '–' + (from + shown.length) + ' of ' + rows.length + (rows.length < d.cases.length ? ' (' + d.cases.length + ' cases)' : ''); caseClear.hidden = !caseChosen.result && !caseChosen.rung && !caseChosen.origin && !caseChosen.query;
    casePager.textContent = ''; if (pages > 1) { const go = step => () => { caseChosen.page += step; drawCases(); };
      casePager.append(el('button', {className: 'chip', type: 'button', textContent: '← Previous', disabled: caseChosen.page === 0, onclick: go(-1)}), el('button', {className: 'chip', type: 'button', textContent: 'Next →', disabled: caseChosen.page >= pages - 1, onclick: go(1)})); }
    caseTable.textContent = ''; caseTable.append(rows.length ? el('table', {className: 'fit'},
    el('tr', {}, ...heads('cases', ['Case', 'Rung guarded', 'Origin', 'Result', 'Last 10 runs', 'Last run', 'Since'], () => { caseChosen.page = 0; drawCases(); }).map((th, at) => Object.assign(th, {className: th.className + ' ' + CASE_COLS[at]}))),
    ...shown.map(c => el('tr', {}, el('td', {className: 'c-case', textContent: c.name}), el('td', {className: 'muted c-rung', textContent: c.rung ?? '—'}), el('td', {className: 'muted c-origin', textContent: c.origin || '—'}), el('td', {className: 'c-result'}, c.ok ? el('span', {className: 'pill s-ready', textContent: 'passed'}) : el('span', {className: 'pill s-posting', textContent: 'failed'}),
      c.note ? el('div', {className: 'muted clamp', title: c.note, textContent: c.note}) : null), el('td', {className: 'c-runs'}, dots(c.history)), el('td', {className: 'muted c-last'}, shaLink(c.sha, c.at)),
      el('td', {className: 'muted c-since'}, shaLink(c.since.sha, c.since.at))))) : el('p', {className: 'muted', textContent: 'No case matches.'})); };
  panels.fixed.append(el('section', {}, el('h2', {textContent: 'Page cases'}),
    el('p', {className: 'muted', textContent: 'Each case checks one mechanism on a small page with a stubbed AI answer; a green row means the mechanism still works, not that the site works. ' + originCount('captured') + ' captured from a real page · ' + originCount('hand-cut') + ' hand-cut. A fix is confirmed offline on the Fixed tab, from the row\\u2019s recording, never from a case.'}),
    d.cases.length ? caseBox
    : el('p', {className: 'muted', textContent: 'No replay from CI on main yet: the next merge to main uploads one (.github/workflows/page-cases.yml).'}))); if (d.cases.length) drawCases();
`;
