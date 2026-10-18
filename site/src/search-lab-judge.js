// What /admin/lab-job-search says about each candidate (owner's decision 3, 18 Oct 2026): the newest run against the last green one. Pure: rows in, states out.
//   failed   the newest run's step crashed (never thin numbers)
//   stale    the tape lacks requests this build makes (the page says how many): its numbers are not compared, and it never becomes the last green run
//   worse    a count (jobs in places, fit 70+) is lower, a time is more than 25 % slower, or a time that was reached is not reached; the control gets no tolerance on times
//   new      no earlier green run to compare with
//   working  no worse than the last green run
// "Last green" = the newest earlier run that was neither failed nor worse. Guard: test/search-lab.test.js.
export const TOLERANCE = 0.25;
const COUNTS = [['in_places', 'jobs in your places'], ['fit70', 'jobs scoring 70+']];
// One name for each time, used on every screen of the Lab (owner, 18 Oct 2026: "Time to first job" is the number he watches).
export const TIME_NAMES = {first_s: 'Time to first job', tenth_s: 'Time to 10th job', fit_s: 'Time to first 70+ job'};
const TIMES = Object.entries(TIME_NAMES);

export function reasons(now, base, control = false) {
  const out = [];
  for (const [field, name] of COUNTS) if (base[field] != null && (now[field] ?? 0) < base[field]) out.push(`${name}: ${base[field]} → ${now[field] ?? 0}`);
  for (const [field, name] of TIMES) {
    if (base[field] == null) continue;
    if (now[field] == null) out.push(`${name}: ${base[field]} s → not reached`);
    else if (now[field] > base[field] * (control ? 1 : 1 + TOLERANCE)) out.push(`${name}: ${base[field]} s → ${now[field]} s`);
  }
  return out;
}

// rows: every kept run (any order). Returns one entry per candidate: {candidate, label, control, state, why, now, base}.
export function judge(rows) {
  const by = new Map();
  for (const row of [...rows].sort((a, b) => a.run_at.localeCompare(b.run_at))) by.set(row.candidate, [...(by.get(row.candidate) || []), row]);
  return [...by.entries()].map(([candidate, list]) => {
    const now = list.at(-1), control = !!now.control;
    let green = null;
    for (const row of list.slice(0, -1)) if (row.state === 'ok' && !(green && reasons(row, green, !!row.control).length)) green = row;
    const note = now.state === 'failed' ? [`a step crashed: ${now.failed_step}`] : now.state === 'stale' ? [`${now.failed_step}: record this candidate again`] : null;
    const why = note || (green ? reasons(now, green, control) : []);
    const state = now.state === 'failed' || now.state === 'stale' ? now.state : !green ? 'new' : why.length ? 'worse' : 'working';
    return {candidate, label: now.label || candidate, control, state, why, now, base: green};
  }).sort((a, b) => Number(a.control) - Number(b.control) || a.label.localeCompare(b.label));
}
