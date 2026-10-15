// The client side of /admin/lab-form-filling's Resolution section, inside src/applying.js's page (it uses that page's el, tile, heads, sortRows, ago and its s-*/st-* pill colours): the headline tile,
// and one table of every pool row, each with its ending as a pill. The pills are the legend and the filter. Words come from extension/ladder/endings.js; guard: test/applying-resolution.test.js.
import {CAUSES, ENDING_MEANS, WORST_FIRST} from '../../extension/ladder/endings.js';

export const RESOLUTION_CSS = '.resolution .endings{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 6px}.resolution button.pill{border:0;cursor:pointer;font-family:inherit}'
  + '.resolution button.pill.off{opacity:.45}.resolution button.pill.on{outline:2px solid var(--text);outline-offset:1px}.resolution .key{font-size:12px;margin:0 0 10px}.resolution .key b{color:var(--text)}'
  + '.resolution table{margin-top:6px}.resolution tr.apart td{opacity:.6}.resolution .sample{overflow-wrap:anywhere}.resolution td.why{white-space:normal}';
export const RESOLUTION_SCRIPT = `
  const ENDING_TONE = {ready: 's-ready', told: 's-form', handed: 's-form', blind: 's-account', data_missing: 's-account', site_broken: 's-none', unresolved: 's-posting', held: 'st-held'};
  const WORST_FIRST = ${JSON.stringify(WORST_FIRST)}, ENDING_MEANS = ${JSON.stringify(ENDING_MEANS)}, CAUSES = ${JSON.stringify(CAUSES)};
  const SINCE = {'↑': 'better than its previous run', '↓': 'worse than its previous run', '=': 'the same as its previous run'};
  let endingPick = null;   // the pill clicked: only its rows
  // A snapshot computed before this tile existed (the page's data is kept 10 minutes) has no resolution: an empty tile, an empty box.
  const resolutionTile = r => tile(!r || r.raw == null ? '–' : r.raw + '%', 'Resolved', d.tileTones ? d.tileTones.resolved : '',
    !r ? 'No ending yet' : (r.weighted == null ? 'No demand weight yet' : r.weighted + '% weighted by demand') + ' · ' + r.unresolved + ' unresolved',
    'The newest run of each pool row ends in one fixed ending; resolved = every ending but unresolved. Only runs of main count: CI on main, and Mac runs whose extension is the one on main.' + (r ? ' ' + r.held + ' row(s) held by the test are not measured.' : '') + ' ' + (d.tileRules ? d.tileRules.resolved : ''));
  function drawResolution(box, r) {
    box.textContent = '';
    if (!r) return;
    const redraw = () => drawResolution(box, r), rows = r.rows || [];
    const counts = Object.fromEntries(WORST_FIRST.map(word => [word, word === 'held' ? r.held : r.endings[word]]));
    if (endingPick && !counts[endingPick]) endingPick = null;
    const shown = endingPick ? rows.filter(item => item.ending === endingPick) : rows;
    const GET = [item => item.row.toLowerCase(), item => item.platform, item => WORST_FIRST.indexOf(item.ending), item => (item.step ? d.steps.indexOf(item.step) : null), item => (item.cause ? CAUSES[item.cause] : null), item => item.day, item => item.since];
    const WEEK_GET = [week => week.week, week => week.measured, week => week.raw];
    const pill = word => el('button', {className: 'pill ' + ENDING_TONE[word] + (endingPick === word ? ' on' : endingPick ? ' off' : ''), title: ENDING_MEANS[word] + (endingPick === word ? ' (click to show all rows)' : ' (click to show only these rows)'),
      textContent: word.replace('_', ' ') + ' ' + counts[word], onclick: () => { endingPick = endingPick === word ? null : word; redraw(); }});
    const run = item => item.source === 'ci' ? (item.run ? el('a', {href: 'https://github.com/GarryOne/job-pilotto/actions/runs/' + item.run, target: '_blank', rel: 'noopener', textContent: item.day + ' · CI'}) : item.day + ' · CI') : item.day + ' · Mac';
    box.append(...[el('h2', {textContent: 'Resolution · how each application ends'}),   // filtered: append() writes a null as the text "null"
      el('p', {className: 'muted', textContent: r.measured ? r.resolved + ' of ' + r.measured + ' pool rows resolved (' + r.raw + '%)' + (r.weighted == null ? '' : '; weighted by real demand ' + r.weighted + '%') + '. ' + r.held + ' held by the test, not measured. Click an ending to show only its rows.' : 'No ending uploaded yet: the next pool run sends them.'}),
      el('div', {className: 'endings'}, ...WORST_FIRST.map(pill)),
      el('p', {className: 'muted key'}, ...WORST_FIRST.flatMap((word, at) => [at ? ' · ' : '', el('b', {textContent: word.replace('_', ' ')}), ' ' + ENDING_MEANS[word]])),
      shown.length ? el('table', {className: 'fit'}, el('tr', {}, ...heads('resolution', ['Row', 'Platform', 'Ending', 'Where it stopped', 'Why', 'Last run', 'Since'], redraw)),
        ...sortRows('resolution', shown, GET).map(item => el('tr', {className: item.ending === 'held' ? 'apart' : ''}, el('td', {textContent: item.row}), el('td', {className: 'muted', textContent: item.platform}),
          el('td', {}, el('span', {className: 'pill ' + ENDING_TONE[item.ending], title: ENDING_MEANS[item.ending], textContent: item.ending.replace('_', ' ')})),
          el('td', {className: 'muted', textContent: item.step || '–'}), el('td', {className: 'muted why', textContent: item.cause ? CAUSES[item.cause] : '–'}),
          el('td', {className: 'muted'}, run(item)), el('td', {className: 'muted', title: SINCE[item.since] || 'no earlier run', textContent: item.since || '–'})))) : el('p', {className: 'muted', textContent: 'No row.'}),
      el('p', {className: 'muted key', textContent: 'Where it stopped: the step the run reached (none, posting, account, code/bot, form, ready). Why: what ended it, a fixed word the run reports (a dash: an older run that did not say). Since: ↑ better, ↓ worse, = same as the previous run.'}),
      r.samples.length ? el('p', {className: 'muted sample', textContent: 'Weighted by the share of matched jobs per platform; rows behind it: ' + r.samples.map(item => item.platform + ' ' + item.share + '%: ' + item.rows).join(' · ') + '. A platform with few rows moves the weighted number a lot.'}) : null,
      r.weeks.length > 1 ? el('table', {className: 'fit'}, el('tr', {}, ...heads('weeks', ['Week of', 'Rows', 'Resolved'], redraw)),
        ...sortRows('weeks', r.weeks, WEEK_GET).map(week => el('tr', {}, el('td', {textContent: week.week}), el('td', {className: 'muted', textContent: week.measured}), el('td', {textContent: week.raw == null ? '–' : week.raw + '%'})))) : null].filter(Boolean));
  }
`;
