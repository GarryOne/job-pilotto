// The Lab Job Search "History" screen (owner, 18 Oct 2026: "we have only one screen: Lab ... we should have more"): every kept run of every candidate (the last 30), newest first, with a line per number
// across the builds and the state each run was in. Counts, seconds and build shas only. Guard: test/search-lab.test.js.
import {esc} from './stats.js';
import {TIME_NAMES} from './search-lab-judge.js';
import {TONE_COLOR, spark} from './search-lab-visuals.js';

const fmt = value => (value == null ? '–' : Number(value).toLocaleString('en-US'));
const clock = value => (value == null ? '–' : value < 60 ? `${value} s` : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`);
const STATE = {ok: ['Replayed', 'good'], stale: ['Tape stale', 'wait'], failed: ['FAILED', 'bad']};

export function historySection(all) {
  const by = new Map();
  for (const run of [...all].sort((a, b) => a.run_at.localeCompare(b.run_at))) by.set(run.candidate, [...(by.get(run.candidate) || []), run]);
  if (!by.size) return '<section class="card"><p class="muted">No run kept yet.</p></section>';
  return [...by.entries()].map(([candidate, runs]) => {
    const label = runs.at(-1).label || candidate, line = (field, color, name) => `<div><span class="muted">${name}</span>${spark(runs.map(run => run[field]), color, 220, 38)}</div>`;
    const body = [...runs].reverse().map(run => {
      const [word, tone] = STATE[run.state] || [run.state, 'wait'];
      return `<tr><td>${esc(run.run_at.slice(0, 16).replace('T', ' '))}</td><td><code>${esc((run.build || '–').slice(0, 7))}</code></td><td><span class="state ${tone}">${word}</span></td>
<td class="num">${clock(run.first_s)}</td><td class="num">${clock(run.tenth_s)}</td><td class="num">${clock(run.fit_s)}</td><td class="num">${fmt(run.in_places)}</td><td class="num">${fmt(run.scored)}</td><td class="num">${fmt(run.fit70)}</td></tr>`;
    }).join('');
    return `<section class="card"><h2>${esc(label)}${runs.at(-1).control ? ' <span class="chip">control</span>' : ''} <span class="muted">· ${runs.length} run${runs.length === 1 ? '' : 's'}</span></h2>
<div class="lv-sparks">${line('in_places', TONE_COLOR.info, 'jobs in places')}${line('fit70', TONE_COLOR.good, 'scoring 70+')}${line('first_s', TONE_COLOR.wait, `${TIME_NAMES.first_s}, s`)}${line('tenth_s', TONE_COLOR.mute, `${TIME_NAMES.tenth_s}, s`)}</div>
<div class="scroll"><table class="lv-hist"><tr><th>Run (UTC)</th><th>Build</th><th>State</th><th class="num">${TIME_NAMES.first_s}</th><th class="num">${TIME_NAMES.tenth_s}</th><th class="num">${TIME_NAMES.fit_s}</th><th class="num">In places</th><th class="num">Scored</th><th class="num">70+</th></tr>${body}</table></div></section>`;
  }).join('');
}
