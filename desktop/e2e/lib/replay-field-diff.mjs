// The replay gate's evidence for a worse row (owner, 14 Oct 2026): which fields changed outcome against the baseline, and the line to copy to accept it. Labels and outcomes only, never a value.
// Guard: e2e/test/replay-field-diff.test.mjs.
const clean = text => String(text ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim().slice(0, 60);

// (the baseline's outcome, this run's outcome) -> [{label, before, now}] for every field whose outcome differs ('absent' = not on the page in that run); null when either side kept no field list (a baseline from before this).
export function fieldDiff(before, now) {
  if (!Array.isArray(before?.fields) || !Array.isArray(now?.fields)) return null;
  const seen = (list, label) => { const hit = list.find(item => clean(item.label) === label); return hit ? clean(hit.outcome) || '?' : 'absent'; };
  const labels = [...new Set([...before.fields, ...now.fields].map(item => clean(item.label)))].filter(Boolean);
  return labels.map(label => ({label, before: seen(before.fields, label), now: seen(now.fields, label)})).filter(item => item.before !== item.now);
}

// (a worse row's name, its verdict row, the diff) -> Markdown lines: the diff table (or why there is none) and the copy-ready accept line with the row's numbers.
export function evidence(name, row, diff, base) {
  const lines = [`#### ${name}`, ''];
  if (diff && diff.length) lines.push('| Field | Baseline | This PR |', '|---|---|---|', ...diff.map(item => `| ${item.label} | ${item.before} | ${item.now} |`));
  else lines.push(diff ? 'No field changed its outcome (the count fell, the fields did not).' : 'No field list in the baseline yet (the next green scheduled replay keeps one): the counts above are all there is.');
  const num = item => (item ? `${item.reached || '?'} ${item.filled ?? '?'}/${item.left ?? '?'}` : '?');
  lines.push('', 'To accept, label the PR `replay-accepted` and comment:', '', '```', `Replay-accept: ${name} — <why this drop is intended> (${num(base)} → ${num(row.outcome)})`, '```');
  return lines;
}
