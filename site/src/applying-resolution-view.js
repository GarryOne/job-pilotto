// The client side of /admin/lab-form-filling's Outcomes tab, inside src/applying.js's page (it uses that page's el, tile, heads, sortRows, ago and its s-*/st-* pill colours): the headline tile,
// the ending pills (counts; a press shows that ending's rows in the Sites tab's pool table) and Week by week. "Every pool row" went into the pool table (each row's Last result carries its ending: endingLine)
// and "How the weighted number is built" into the Platform scorecard (src/applying-coverage-view.js), 15 Oct 2026. Words come from extension/ladder/endings.js; guard: test/applying-resolution.test.js.
import {CAUSES, ENDING_MEANS, WORST_FIRST} from '../../extension/ladder/endings.js';

export const RESOLUTION_CSS = '.resolution .endings{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 6px}.resolution button.pill{border:0;cursor:pointer;font-family:inherit}'
  + '.resolution button.pill.on{outline:2px solid var(--text);outline-offset:1px}.resolution .key{font-size:12px;margin:0 0 10px}.resolution .key b{color:var(--text)}'
  + '.resolution table{margin-top:6px}.resolution .rhead{font-size:14px;margin:22px 0 8px}.resolution .rcard{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px 14px 10px;overflow-x:auto}.resolution .rcard table{margin-top:0}'
  + '.endline .pill.mini{font-size:10px;padding:1px 6px;margin-right:2px}.endline a{color:inherit}'
  + '.wbar{display:inline-block;vertical-align:middle;width:90px;height:8px;border-radius:4px;background:var(--line);margin-right:8px;overflow:hidden}.wbar i{display:block;height:100%;background:var(--blue)}.fit tr.unmeasured td:first-child,td.none{color:var(--red);font-weight:600}.fit tr.unmeasured .wbar i{background:var(--red)}';
export const RESOLUTION_SCRIPT = `
  const ENDING_TONE = {ready: 's-ready', told: 's-form', handed: 's-form', blind: 's-account', data_missing: 's-account', site_broken: 's-none', unresolved: 's-posting', held: 'st-held'};
  const WORST_FIRST = ${JSON.stringify(WORST_FIRST)}, ENDING_MEANS = ${JSON.stringify(ENDING_MEANS)}, CAUSES = ${JSON.stringify(CAUSES)};
  const SINCE = {'↑': 'better than its previous run', '↓': 'worse than its previous run', '=': 'the same as its previous run'};
  // The ending shown in the pool table (Sites tab): each pool row's newest ending, found by the row's shape or name (the pool and the resolution share the row names). endingPick is the filter.
  let endingPick = null, poolRedraw = () => {}, syncEnding = () => {};   // the pool table sets the last two once it exists (src/applying.js)
  const endingRows = new Map(((d.resolution && d.resolution.rows) || []).map(item => [item.row, item]));
  const endingOf = s => endingRows.get(s.shape) || endingRows.get(s.name) || null;
  // ONE definition of an ending (owner, 15 Oct 2026: "held" counted 20, 17 and 12): a row's ending is its newest main run's, the same list the Outcomes pills count; a row with none is "no ending yet", never guessed from its status.
  const NO_ENDING = 'none', endingWordOf = s => (endingOf(s) ? endingOf(s).ending : NO_ENDING);
  const endingMatch = s => !endingPick || endingWordOf(s) === endingPick;
  const runOf = item => item.source === 'ci' ? (item.run ? el('a', {href: 'https://github.com/GarryOne/job-pilotto/actions/runs/' + item.run, target: '_blank', rel: 'noopener', textContent: item.day + ' · CI', onclick: event => event.stopPropagation()}) : item.day + ' · CI') : item.day + ' · Mac';
  const endingLine = s => { const item = endingOf(s); return item ? el('span', {className: 'stack muted endline', title: ENDING_MEANS[item.ending] + (item.since ? ' · since the previous run: ' + (SINCE[item.since] || '') : '')},
    el('span', {className: 'pill mini ' + ENDING_TONE[item.ending], textContent: item.ending.replace('_', ' ')}), item.cause ? ' ' + CAUSES[item.cause] : '', ' · ', runOf(item), item.since ? ' · ' + item.since : '') : null; };
  // A snapshot computed before this tile existed (the page's data is kept 10 minutes) has no resolution: an empty tile, an empty box.
  const resolutionTile = r => tile(!r || r.raw == null ? '–' : r.raw + '%', 'Resolved', d.tileTones ? d.tileTones.resolved : '',
    !r ? 'No ending yet' : (r.weighted == null ? 'No demand weight yet' : r.weighted + '% weighted by demand') + ' · ' + r.unresolved + ' unresolved',
    'The newest run of each pool row ends in one fixed ending; resolved = every ending but unresolved. Only runs of main count: CI on main, and Mac runs whose extension is the one on main.' + (r ? ' ' + r.held + ' row(s) held by the test are not measured.' : '') + ' ' + (d.tileRules ? d.tileRules.resolved : ''));
  function drawResolution(box, r) {
    box.textContent = '';
    if (!r) return;
    const redraw = () => drawResolution(box, r);
    const counts = Object.fromEntries(WORST_FIRST.map(word => [word, word === 'held' ? r.held : r.endings[word]]));
    const WEEK_GET = [week => week.week, week => week.measured, week => week.raw];
    const pill = word => el('button', {className: 'pill ' + ENDING_TONE[word] + (endingPick === word ? ' on' : ''), title: ENDING_MEANS[word] + ' (a press shows only these rows in the Sites tab)',
      textContent: word.replace('_', ' ') + ' ' + counts[word], onclick: () => { endingPick = word; syncEnding(); poolRedraw(); redraw(); if (typeof location !== 'undefined') location.hash = '#sites'; }});
    box.append(...[el('h2', {textContent: 'Resolution · how each application ends'}),   // filtered: append() writes a null as the text "null"
      el('p', {className: 'muted', textContent: r.measured ? r.resolved + ' of ' + r.measured + ' pool rows resolved (' + r.raw + '%)' + (r.weighted == null ? '' : '; weighted by real demand ' + r.weighted + '%') + '. ' + r.held + ' held by the test, not measured. A press on an ending shows its rows in the Sites tab (its Ending filter has the same counts, plus the rows with no ending yet: ' + (d.pool.length - r.measured - r.held) + ' of ' + d.pool.length + ').' : 'No ending uploaded yet: the next pool run sends them.'}),
      el('div', {className: 'endings'}, ...WORST_FIRST.map(pill)),
      el('p', {className: 'muted key'}, ...WORST_FIRST.flatMap((word, at) => [at ? ' · ' : '', el('b', {textContent: word.replace('_', ' ')}), ' ' + ENDING_MEANS[word]])),
      r.weeks.length > 1 ? el('h3', {className: 'rhead', textContent: 'Week by week'}) : null,
      r.weeks.length > 1 ? el('div', {className: 'rcard'}, el('table', {className: 'fit'}, el('tr', {}, ...heads('weeks', ['Week of', 'Rows', 'Resolved'], redraw)),
        ...sortRows('weeks', r.weeks, WEEK_GET).map(week => el('tr', {}, el('td', {textContent: week.week}), el('td', {className: 'muted', textContent: week.measured}), el('td', {textContent: week.raw == null ? '–' : week.raw + '%'}))))) : null].filter(Boolean));
  }
`;
