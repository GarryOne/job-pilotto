// The Focus card of an interview to prepare for: its meta line, its main button and its ⋯ entries, from the item
// src/focus.py builds (prep_at: when the kit was built; prep_stale: an interview was reviewed or booked since).
export const COST_HINT = 'Claude Sonnet builds it from the job, your Profile and your earlier interviews';

// "29 Sept", or "today"
export function prepDay(at, today = new Date().toLocaleDateString('en-CA')) {
  const day = String(at || '').slice(0, 10);
  return !day || day === today ? 'today' : new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', {day: 'numeric', month: 'short'});
}

// {meta: [...], primary: {label, run: 'build' | 'open' | 'join', tone, title}, more: [{label, icon, run}]}
export function prepCard(item, today) {
  const day = at => prepDay(at, today);
  const on = at => (day(at) === 'today' ? 'today' : `on ${day(at)}`);
  const job = item.meta?.[0];
  const build = {label: 'Build prep kit', run: 'build', tone: 'primary', title: COST_HINT};
  if (item.building) return {meta: [job, 'building the prep kit…'], primary: {label: 'Building…', run: 'join', tone: 'secondary'}, more: []};
  if (!item.prep_at) return {meta: item.meta || [], primary: build, more: []};
  if (item.prep_stale) {
    // The kit was for an earlier call: building the one for this round comes first; the earlier kit stays on the page.
    const since = item.prep_why === 'booked' ? `the interview was booked or moved ${on(item.prep_since)}`
      : `your call ${on(item.prep_since)} was reviewed since`;
    return {meta: [job, `Kit from ${day(item.prep_at)} · ${since}`], primary: {...build, label: 'Build new prep kit'},
      more: [{icon: 'file', label: `Open earlier kit (built ${day(item.prep_at)})`, run: 'open'}]};
  }
  return {meta: [job, `✓ prep kit ready · built ${day(item.prep_at)}`], primary: {label: 'Open prep kit', run: 'open', tone: 'primary'},
    more: [{icon: 'refresh', label: 'Build the prep kit again', run: 'build', title: COST_HINT}]};
}
