// One number per week for each section of the admin pages (oldest week first), from the tables the site already keeps. Each series
// says what it counts; a section with no data yet shows empty bars, never an error. Used by /admin/app, /admin/insights and the
// /admin overview (src/admin.js draws them).
import {byWeek, ratio, since, sum} from './admin.js';

const json = text => { try { return JSON.parse(text) || {}; } catch { return {}; } };
const rows = async (db, sql, ...binds) => { try { return (await db.prepare(sql).bind(...binds).all()).results || []; } catch { return []; } };
const distinct = key => list => new Set(list.map(row => row[key])).size;
const count = list => list.length;
const PROBLEMS = "('crash', 'run_failed', 'stuck', 'form_issue')";
const ACTED = ['saved', 'applying', 'applied', 'screening', 'interviewing', 'offer'];
const GOOD = ['reply', 'screening', 'offer'];

// {key: {label, values, format?, higherIsBetter?}}
export async function appTrends(db, now = new Date()) {
  const from = since(now);
  const health = await rows(db, "SELECT day, install, data FROM telemetry WHERE kind = 'health' AND day >= ?", from);
  const setup = (await rows(db, "SELECT day, install, data FROM telemetry WHERE kind = 'setup' AND day >= ?", from)).map(row => ({...row, data: json(row.data)}));
  const firsts = await rows(db, 'SELECT install, MIN(day) AS day FROM telemetry GROUP BY install HAVING MIN(day) >= ?', from);
  const problems = await rows(db, `SELECT day FROM telemetry WHERE kind IN ${PROBLEMS} AND day >= ?`, from);
  const fills = await rows(db, 'SELECT day, SUM(n) AS n FROM form_exposure WHERE day >= ? GROUP BY day', from);
  const guard = await rows(db, 'SELECT day, n FROM anomalies WHERE day >= ?', from);
  const feedback = await rows(db, 'SELECT day FROM feedback WHERE day >= ?', from);
  const gate = setup.filter(row => row.data.step === 'notion_gate' && row.data.outcome !== 'viewed')
    .map(row => ({day: row.day, shown: 1, connected: row.data.outcome === 'connected' ? 1 : 0}));
  const pct = value => `${Math.round(value * 100)}%`;
  return {
    machines: {label: 'active installs', values: byWeek(health, now, distinct('install'))},
    helped: {label: 'runs that worked', values: byWeek(health.map(row => ({day: row.day, ok: Number(json(row.data).runsOk) || 0})), now, sum('ok'))},
    channels: {label: 'new installs', values: byWeek(firsts, now, count)},
    setup: {label: 'setups finished', values: byWeek(setup.filter(row => row.data.step === 'done'), now, distinct('install'))},
    notion: {label: 'connected when asked', values: byWeek(gate, now, ratio('connected', 'shown')), format: pct},
    problems: {label: 'problem reports', values: byWeek(problems, now, count), higherIsBetter: false},
    asks: {label: 'forms filled', values: byWeek(fills, now, sum('n'))},
    guard: {label: 'access anomalies', values: byWeek(guard, now, sum('n')), higherIsBetter: false},
    feedback: {label: 'messages', values: byWeek(feedback, now, count)},
  };
}

export async function insightTrends(db, now = new Date()) {
  const from = since(now);
  const coverage = await rows(db, 'SELECT day, matched, in_places FROM intel_coverage WHERE day >= ?', from);
  const terms = await rows(db, 'SELECT day, n FROM intel_terms WHERE day >= ?', from);
  const dismiss = await rows(db, 'SELECT day, n FROM intel_dismiss WHERE day >= ?', from);
  const scores = (await rows(db, 'SELECT day, state, n FROM intel_scores WHERE day >= ?', from)).map(row => ({day: row.day, all: row.n, acted: ACTED.includes(row.state) ? row.n : 0}));
  const replies = (await rows(db, 'SELECT day, outcome, n FROM intel_replies WHERE day >= ?', from)).map(row => ({day: row.day, all: row.n, good: GOOD.includes(row.outcome) ? row.n : 0}));
  const sources = await rows(db, 'SELECT day, seen, acted FROM intel_sources WHERE day >= ?', from);
  const fixes = await rows(db, 'SELECT day, filled, corrected FROM intel_fix_days WHERE day >= ?', from);
  const empty = await rows(db, 'SELECT day, SUM(n) AS left FROM fill_reasons WHERE day >= ? GROUP BY day', from);
  const fills = await rows(db, 'SELECT day, SUM(n) AS forms FROM form_exposure WHERE day >= ? GROUP BY day', from);
  const cost = await rows(db, 'SELECT day, micro_usd FROM ai_calls WHERE day >= ?', from);
  const pct = value => `${Math.round(value * 100)}%`;
  return {
    coverage: {label: 'postings the keywords catch', values: byWeek(coverage, now, ratio('matched', 'in_places')), format: pct},
    terms: {label: 'role words accepted', values: byWeek(terms, now, sum('n'))},
    dismiss: {label: 'jobs dismissed', values: byWeek(dismiss, now, sum('n'))},
    scores: {label: 'jobs acted on', values: byWeek(scores, now, ratio('acted', 'all')), format: pct},
    replies: {label: 'replies, calls, offers', values: byWeek(replies, now, ratio('good', 'all')), format: pct},
    sources: {label: 'jobs acted on', values: byWeek(sources, now, ratio('acted', 'seen')), format: pct},
    fixes: {label: 'answers changed', values: byWeek(fixes, now, ratio('corrected', 'filled')), format: pct, higherIsBetter: false},
    empty: {label: 'fields left per form', values: byWeek([...empty, ...fills], now, ratio('left', 'forms')), format: v => v.toFixed(1), higherIsBetter: false},
    cost: {label: 'AI cost', values: byWeek(cost, now, list => sum('micro_usd')(list) / 1e6), format: v => `$${v.toFixed(2)}`, higherIsBetter: false},
  };
}
