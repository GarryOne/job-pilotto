// What the Benchmark Form Filling page counts (owner, 15 Oct 2026): one summary row per scored run (a tool on a form) -> the scores per tool, the grid per form, our trend per build, for ONE applicant at a time
// (thin and grown, and user mode and harness mode, are never added together). Pure functions: no names of tools, forms or sites live here, they arrive as data. Guard: test/benchmark.test.js.
// raw = right / required; product = right / (required - not answerable - consent holds - reader duplicates); ceiling = (required - not answerable) / required (the most the applicant's facts allow).
export const APPLICANTS = ['thin', 'grown'];
// user = what real users run (the repair rung acts for every user since #873: a build that has it, or a run with it off); harness = a build before #873 run with the test harness's repair rung on (ladderAct); unknown = the run did not say. Only our extension has a mode; the other tools' rows carry 'any'. The page's headline is user mode.
export const MODES = ['user', 'harness', 'unknown'];
// Bake-off harness fixes made after some runs were scored (saved runs cannot be re-read); a run lists the ones it predates. Each hits every tool the same way.
export const FIX_KEYS = ['trail', 'select'];
export const segmentKey = (applicant, mode) => `${applicant}:${mode}`;
const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
export const countable = row => Math.max(0, row.required - row.unans - row.holds - row.dups);
export const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : null);

// The latest run per form out of a tool's rows: a re-run replaces the older one, so a total never counts a form twice.
const latestPerForm = rows => [...new Map([...rows].sort((a, b) => a.at.localeCompare(b.at)).map(row => [row.form, row])).values()];

export function totals(rows) {
  const t = {forms: rows.length, required: sum(rows, 'required'), right: sum(rows, 'right'), wrong: sum(rows, 'wrong'), empty: sum(rows, 'empty'), unans: sum(rows, 'unans'), holds: sum(rows, 'holds'), dups: sum(rows, 'dups')};
  const count = rows.reduce((total, row) => total + countable(row), 0);
  return {...t, countable: count, raw: share(t.right, t.required), product: share(t.right, count), ceiling: share(t.required - t.unans, t.required), at: rows.map(row => row.at).sort().at(-1) || ''};
}

const byKey = (rows, key) => { const map = new Map(); for (const row of rows) { const k = key(row); map.set(k, [...(map.get(k) || []), row]); } return map; };
const formOrder = (a, b) => a.localeCompare(b, 'en', {numeric: true});

// rows -> {segments: {'thin:user': {tools, forms, grid, trend}}}: tools = our newest build first, then the others best raw score first.
// How objective the numbers are, from the stored runs: the days each side ran, the runs behind each number, the mode, the held-out forms. Text the data cannot show is the page's.
export function objectivity({mine, current, others, forms, mode, shown = []}) {
  const day = row => row.at.slice(0, 10), ourDay = current ? current.at.slice(0, 10) : '';
  const otherDays = others.map(tool => tool.at.slice(0, 10)).sort(), counts = [];
  for (const form of forms) {
    if (current) counts.push(mine.filter(row => row.ours && row.build === current.build && row.form === form).length);
    for (const tool of others) counts.push(mine.filter(row => !row.ours && row.tool === tool.tool && row.form === form).length);
  }
  const pointed = new Set(forms.filter(form => mine.some(row => row.form === form && row.heldout)));
  return {ourDay, firstOtherDay: otherDays[0] || '', lastOtherDay: otherDays.at(-1) || '', sameDay: Boolean(ourDay) && otherDays.every(d => d === ourDay), minRuns: counts.length ? Math.min(...counts) : 0,
    heldout: pointed.size, fixes: Object.fromEntries(FIX_KEYS.map(key => [key, shown.filter(row => String(row.fixes || '').split(',').includes(key)).length])), shown: shown.length, forms: forms.length, userMode: mode === 'user'};
}

export function summarize(rows) {
  const out = {};
  // The mode is OUR extension's (the repair rung on or off); other tools have none, so they are in every view of their applicant. A view exists for each mode ours has runs in; with none of ours, a user-mode view of the others.
  const views = APPLICANTS.flatMap(applicant => {
    const ourModes = MODES.filter(mode => rows.some(row => row.applicant === applicant && row.ours && row.mode === mode));
    return (ourModes.length ? ourModes : rows.some(row => row.applicant === applicant) ? ['user'] : []).map(mode => [applicant, mode]);
  });
  for (const [applicant, mode] of views) {
    const mine = rows.filter(row => row.applicant === applicant && (!row.ours || row.mode === mode));
    // Everything is compared on the forms of our newest build (a build or a tool that has not run one counts fewer forms, and its Forms column says so).
    const newest = [...byKey(mine.filter(row => row.ours), row => row.build)].map(([build, list]) => ({build, rows: latestPerForm(list)})).sort((a, b) => totals(a.rows).at.localeCompare(totals(b.rows).at)).at(-1);
    const keep = new Set((newest?.rows || mine).map(row => row.form)), inside = rows => rows.filter(row => keep.has(row.form));
    const builds = [...byKey(mine.filter(row => row.ours), row => row.build)].map(([build, list]) => ({build, ...totals(inside(latestPerForm(list))), rows: inside(latestPerForm(list))})).sort((a, b) => a.at.localeCompare(b.at));
    const current = builds.at(-1);
    const others = [...byKey(mine.filter(row => !row.ours), row => row.tool)].map(([tool, list]) => ({tool, ours: false, ...totals(inside(latestPerForm(list))), rows: inside(latestPerForm(list))}))
      .filter(tool => tool.forms).sort((a, b) => (b.raw ?? -1) - (a.raw ?? -1) || a.tool.localeCompare(b.tool));
    const tools = [...(current ? [{tool: 'Our extension', ours: true, build: current.build, ...current}] : []), ...others];
    const forms = [...keep].sort(formOrder);
    const grid = Object.fromEntries(tools.map(tool => [tool.tool, Object.fromEntries(tool.rows.map(row => [row.form, {required: row.required, right: row.right, wrong: row.wrong, empty: row.empty}]))]));
    out[segmentKey(applicant, mode)] = {
      tools: tools.map(({rows: _rows, ...tool}) => tool), forms, grid, objectivity: objectivity({mine, current, others, forms, mode, shown: tools.flatMap(tool => tool.rows)}),
      trend: builds.map(({rows: _rows, build, forms: count, at, raw, product, wrong, ceiling}) => ({build, at, forms: count, raw, product, wrong, ceiling})),
    };
  }
  return {schema: 3, segments: out};
}
