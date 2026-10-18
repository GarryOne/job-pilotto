// The Lab Job Search "Needs a fix" and "Fixed" tabs (owner, 18 Oct 2026: "Let's have needs a fix and fixed tabs"): each candidate's kept runs are walked once, and a run of bad results (FAILED, Worse, or a stale tape)
// that starts after a good one is an episode: still going = Needs a fix, ended by a good run = Fixed. Derived from the runs the page already keeps (no new table), so it covers the last 30 runs of each candidate.
// Counts, seconds and build ids only. A compare link (last good build ... first bad build) shows which commits to read. Guard: test/search-lab-fixes.test.js.
import {esc} from './stats.js';
import {reasons} from './search-lab-judge.js';

const REPO = 'https://github.com/GarryOne/job-pilotto';
const KIND = {failed: ['FAILED', 'bad', 3], worse: ['Worse', 'bad', 2], stale: ['Tape stale', 'wait', 1]};
const short = build => (build || '–').slice(0, 7);
const when = iso => (iso ? `${iso.slice(5, 10)} ${iso.slice(11, 16)} UTC` : '–');
const span = ms => { const minutes = Math.max(0, Math.round(ms / 60000)); return minutes < 90 ? `${minutes} min` : minutes < 2880 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} days`; };
const length = (from, to) => span(Date.parse(to) - Date.parse(from));
const compare = (a, b) => (a && b && a !== b ? `<a href="${REPO}/compare/${esc(a)}...${esc(b)}" target="_blank" rel="noopener">commits in between</a>` : '');

// One candidate's runs (any order) -> [{kind, runs, start, end|null, green, fixedBy|null, why}] oldest first. A run is bad when it FAILED, is a stale tape, or is Worse than the last green run (as src/search-lab-judge.js).
export function episodes(list) {
  const out = [];
  let green = null, open = null;
  for (const run of [...list].sort((a, b) => a.run_at.localeCompare(b.run_at))) {
    const why = run.state === 'failed' ? [`a step crashed: ${run.failed_step}`] : run.state === 'stale' ? [String(run.failed_step || 'Tape stale')] : green ? reasons(run, green, !!run.control) : [];
    const kind = run.state === 'failed' || run.state === 'stale' ? run.state : why.length ? 'worse' : null;
    if (kind) {
      if (!open) { open = {candidate: run.candidate, label: run.label || run.candidate, kind, runs: 0, start: run, end: null, green, why}; out.push(open); }
      open.runs += 1;
      if (KIND[kind][2] > KIND[open.kind][2]) { open.kind = kind; open.why = why; }
    } else {
      if (open) { open.end = run; open = null; }
      green = run;
    }
  }
  return out;
}

export function allEpisodes(rows) {
  const by = new Map();
  for (const row of rows) by.set(row.candidate, [...(by.get(row.candidate) || []), row]);
  return [...by.values()].flatMap(episodes);
}

const chip = kind => `<span class="state ${KIND[kind][1]}">${KIND[kind][0]}</span>`;

export function needsSection(rows, now = new Date()) {
  const open = allEpisodes(rows).filter(episode => !episode.end).sort((a, b) => a.start.run_at.localeCompare(b.start.run_at));
  if (!open.length) return '<section class="card"><h2>Needs a fix</h2><p class="muted">Nothing: every candidate\'s newest run is working.</p></section>';
  const tile = (label, big, tone) => `<section class="card tile" style="border-top:3px solid ${tone}"><span class="muted">${label}</span><b>${big}</b></section>`;
  const count = kind => open.filter(episode => episode.kind === kind).length;
  const cards = open.map(episode => `<section class="card"><h2>${esc(episode.label)} ${chip(episode.kind)}</h2>
<p>${episode.why.map(esc).join('<br>')}</p>
<p class="muted">Since ${esc(when(episode.start.run_at))} (${esc(length(episode.start.run_at, now.toISOString()))}), ${episode.runs} run${episode.runs === 1 ? '' : 's'} · first bad build <code>${esc(short(episode.start.build))}</code> · last good build <code>${esc(short(episode.green?.build))}</code> ${compare(episode.green?.build, episode.start.build)}</p>
${episode.kind === 'stale' ? '<p class="muted">A stale tape is not a bug: the daily heal records it again (or run "heal stale tapes" by hand).</p>' : ''}</section>`).join('');
  return `<div class="tiles">${tile('Need a fix', open.length, '#ff6b6b')}${tile('FAILED', count('failed'), '#ff6b6b')}${tile('Worse', count('worse'), '#f0b44c')}${tile('Tape stale', count('stale'), '#5aa9ff')}${tile('Oldest open', esc(length(open[0].start.run_at, now.toISOString())), '#8d949c')}</div>${cards}`;
}

export function fixedSection(rows) {
  const closed = allEpisodes(rows).filter(episode => episode.end).sort((a, b) => b.end.run_at.localeCompare(a.end.run_at));
  const body = closed.map(episode => `<tr><td><b>${esc(episode.label)}</b></td><td>${chip(episode.kind)}<div class="why">${episode.why.map(esc).join('<br>')}</div></td>
<td>${esc(when(episode.start.run_at))}<div class="why">build <code>${esc(short(episode.start.build))}</code></div></td><td>${esc(when(episode.end.run_at))}<div class="why">build <code>${esc(short(episode.end.build))}</code> ${compare(episode.start.build, episode.end.build)}</div></td>
<td class="num">${esc(length(episode.start.run_at, episode.end.run_at))}</td><td class="num">${episode.runs}</td></tr>`).join('');
  const times = closed.map(episode => Date.parse(episode.end.run_at) - Date.parse(episode.start.run_at)).sort((a, b) => a - b);
  const median = times.length ? span(times[Math.floor((times.length - 1) / 2)]) : '–';
  return `<div class="tiles"><section class="card tile"><span class="muted">Fixed</span><b class="up">${closed.length}</b></section><section class="card tile"><span class="muted">Median time to fix</span><b>${esc(median)}</b></section>
<section class="card tile"><span class="muted">Of them tape heals</span><b>${closed.filter(episode => episode.kind === 'stale').length}</b></section></div>
<section class="card"><h2>Problems that ended</h2><div class="scroll"><table><tr><th>Candidate</th><th>What was wrong</th><th>First seen</th><th>Fixed</th><th class="num">Open for</th><th class="num">Bad runs</th></tr>${body || '<tr><td colspan="6" class="muted">Nothing fixed yet in the runs kept (the last 30 per candidate).</td></tr>'}</table></div></section>`;
}
