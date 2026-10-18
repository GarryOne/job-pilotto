// The Lab Job Search "Experiments" tab (owner, 18 Oct 2026, sketch https://claude.ai/artifact/5nEj5mc4aPknkSJCCxrFbw): one row per measured change, shipped or not, so what was tried, what it moved
// and what was dropped is on /admin and not only in chat. The rows are docs/lab/search-experiments.json, read at deploy: the session that measured adds its row in the PR that ships or drops the change.
// Owner-only like the rest of /admin. Fixed columns, no job or CV text. Guard: test/search-lab-experiments.test.js.
import ROWS from '../../docs/lab/search-experiments.json' with {type: 'json'};
import {esc} from './stats.js';

export const OUTCOMES = {shipped: 'good', 'shipped, then fixed': 'good', 'not shipped': 'bad', parked: 'wait'};
export const FIELDS = ['date', 'what', 'metric', 'before', 'after', 'outcome', 'link'];

// Pure: rows in, the section out (newest first).
export function experimentsSection(rows = ROWS) {
  const body = [...rows].sort((a, b) => b.date.localeCompare(a.date)).map(row => `<tr><td>${esc(row.date)}</td><td><b>${esc(row.what)}</b><div class="why">${esc(row.metric)}</div></td>
<td>${esc(row.before)} → ${esc(row.after)}</td><td><span class="state ${OUTCOMES[row.outcome] || 'wait'}">${esc(row.outcome)}</span></td><td>${esc(row.link)}</td></tr>`).join('');
  const count = outcome => rows.filter(row => row.outcome === outcome).length;
  return `<div class="tiles"><section class="card tile"><span class="muted">Measured changes</span><b>${rows.length}</b></section><section class="card tile"><span class="muted">Shipped</span><b class="up">${count('shipped') + count('shipped, then fixed')}</b></section>
<section class="card tile"><span class="muted">Not shipped</span><b class="down">${count('not shipped')}</b></section><section class="card tile"><span class="muted">Parked</span><b>${count('parked')}</b></section></div>
<section class="card"><h2>What was tried, and what it moved</h2><div class="scroll"><table><tr><th>Date</th><th>What was measured</th><th>Before → after</th><th>Outcome</th><th>Link</th></tr>${body || '<tr><td colspan="5" class="muted">No experiment recorded yet.</td></tr>'}</table></div>
<p class="muted">Rows live in <code>docs/lab/search-experiments.json</code>: add one in the PR that ships or drops a change.</p></section>`;
}
