// The "Report this form" line of /admin/real-form-filling (docs/superpowers/specs/2026-10-15-report-this-form.md §5): how many reports people sent, how many the owner has fetched into the offline
// loop, how many were fixed. Counts only (src/report-form.js holds no host or page); an empty table, or a database without the table yet, shows nothing. Guard: test/report-counts.test.js.
import {esc} from './stats.js';

export async function reportCounts(db) {
  try {
    const {results} = await db.prepare('SELECT status, COUNT(*) AS n FROM form_reports GROUP BY status').all();
    const by = Object.fromEntries((results || []).map(row => [row.status, row.n]));
    const waiting = by.new || 0, fetched = by.fetched || 0, fixed = by.fixed || 0;
    return {received: waiting + fetched + fixed, waiting, fetched, fixed};
  } catch { return null; }
}

export const reportsSection = counts => (!counts?.received ? '' : `<section class="card"><h2>🚩 Reported by a person</h2><small class="muted">Stuck forms people sent with "Report this form": encrypted on their Mac, readable only by the owner. Counts only; the rows themselves are on Lab Form Filling, tagged "Reported by a person".</small>
<div class="wrap"><table><tr><th>Received (last 30 days)</th><th class="n">Waiting</th><th class="n">In the offline loop</th><th class="n">Fixed</th></tr>
<tr><td>${esc(String(counts.received))}</td><td class="n">${counts.waiting}</td><td class="n">${counts.fetched}</td><td class="n">${counts.fixed}</td></tr></table></div></section>`);
