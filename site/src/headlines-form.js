// Headline numbers of the Form filling pages: Real users, Lab, Benchmark, Learning (src/headlines.js; drawn on /admin/form-overview by src/section-overview.js).
// Reuses what each page reads: the left-empty model (fill cards + the thin-data rule), the Lab's own tiles (applying.data), the benchmark snapshot row, the learning answer/recipe tables.
// Real use under 3 installs is "Too few": a tile with the raw counts, never a percentage (src/thin-data.js).
import {byWeek, ratio, since} from './admin.js';
import {leftEmpty} from './left-empty.js';
import {isThin} from './thin-data.js';
import {data as labData} from './applying.js';
import {countTone, shareTone} from './applying-tiles.js';
import {answersByFamily} from './answer-metrics.js';
import {byFamily} from './formlearning.js';

const first = async (env, sql, ...binds) => { try { return env.STATS ? await env.STATS.prepare(sql).bind(...binds).first() : null; } catch { return null; } };
const all = async (env, sql, ...binds) => { try { return env.STATS ? (await env.STATS.prepare(sql).bind(...binds).all()).results || [] : []; } catch { return []; } };
const tone = value => value || 'none';
const num = value => (Number(value) || 0).toLocaleString('en-US', {maximumFractionDigits: 0});
const pct = value => (value == null ? '–' : `${Math.round(value)}%`);

// Real users: the share of required fields filled over the last 14 days, and how many forms from how many installs it rests on.
async function realUsers(env, now) {
  if (!env.STATS) return [{label: 'Required fields filled', value: '–', sub: 'no database', status: 'none'}];
  const model = await leftEmpty(env.STATS, now, 'real'), sample = model.sample || {forms: 0, installs: 0};
  const weekly = byWeek(await all(env, "SELECT day, filled AS ok, required AS n FROM fill_cards WHERE source = 'user' AND day >= ?", since(now)), now, ratio('ok', 'n'));
  const base = `${num(sample.forms)} form${sample.forms === 1 ? '' : 's'} from ${num(sample.installs)} install${sample.installs === 1 ? '' : 's'}`;
  if (!model.required) return [{label: 'Required fields filled', value: 'No data', sub: 'no real fill reported in 14 days', status: 'none'}];
  if (isThin(model.sample)) return [{label: 'Required fields filled', value: 'Too few', sub: `${base} (needs 3+ installs) · ${num(model.required)} required fields, ${num(model.total)} left`, status: 'none', few: true}];
  const share = model.filledShare == null ? null : 100 * model.filledShare;
  return [{label: 'Required fields filled', value: pct(share), sub: `${base} · ${num(model.total)} of ${num(model.required)} left empty`, status: tone(shareTone(share)), series: weekly.map(v => (v == null ? null : 100 * v)), format: pct}];
}

// Lab: the recorded sites' own tiles: share that reached the form, sites needing a fix, regressions of our build (colour rules in src/applying-tiles.js).
async function lab(env, now) {
  if (!env.STATS) return [{label: 'Recorded sites reaching the form', value: '–', sub: 'no database', status: 'none'}];
  const {tiles} = await labData(env.STATS, now), T = {reached: shareTone(tiles.reachedForm), fix: countTone(tiles.needFix), regress: countTone(tiles.regressions)};
  return [{label: 'Recorded sites reaching the form', value: tiles.reachedForm == null ? '–' : pct(tiles.reachedForm), sub: `${num(tiles.sites)} sites in the pool`, status: tone(T.reached)},
    {label: 'Sites needing a fix', value: num(tiles.needFix), sub: `${num(tiles.regressions)} regression${tiles.regressions === 1 ? '' : 's'} of our build`, status: [T.fix, T.regress].includes('bad') ? 'bad' : [T.fix, T.regress].includes('warn') ? 'warn' : 'good'}];
}

// Benchmark: our newest build against the best other tool on the same forms (the first view's raw share); an internal trend, so no colour.
async function benchmark(env) {
  const row = await first(env, 'SELECT body FROM benchmark_snapshot WHERE id = 1');
  let snapshot = null;
  try { snapshot = row ? JSON.parse(row.body) : null; } catch { snapshot = null; }
  const key = Object.keys(snapshot?.segments || {})[0], tools = snapshot?.segments?.[key]?.tools || [];
  const ours = tools.find(tool => tool.ours), other = tools.filter(tool => !tool.ours).sort((a, b) => (b.raw ?? -1) - (a.raw ?? -1))[0];
  if (!ours || ours.raw == null) return [{label: 'Benchmark: ours vs best other', value: 'No data', sub: 'no benchmark run stored yet', status: 'none'}];
  return [{label: 'Benchmark: ours vs best other', value: other?.raw == null ? pct(ours.raw) : `${pct(ours.raw)} vs ${pct(other.raw)}`, sub: `${key.replace(':', ' applicant, ')} mode · internal trend, not a ranking`, status: 'none',
    series: (snapshot.segments[key].trend || []).map(point => point.raw)}];
}

// Learning: the AI's kept answers this week per family (the page's own table), forms filled and finished, and the learned recipes.
async function learning(env, now) {
  const thisWeek = since(now, 7), lastWeek = since(now, 14);
  const answers = env.STATS ? await answersByFamily(env.STATS, thisWeek, lastWeek).catch(() => null) : null;
  const families = env.STATS ? await byFamily(env.STATS, thisWeek).catch(() => null) : null;
  const recipes = await all(env, 'SELECT status, COUNT(*) AS n FROM recipes GROUP BY status');
  const count = status => recipes.find(row => row.status === status)?.n || 0, kept = family => answers?.[family]?.now;
  const withCalls = ['claude', 'openai'].filter(family => kept(family)?.calls);
  const forms = ['claude', 'openai', 'unknown'].reduce((total, family) => total + (families?.[family]?.fills || 0), 0);
  return [
    {label: 'AI answers kept', value: withCalls.length ? pct(100 * (kept(withCalls[0]).keptRate ?? 0)) : 'No data', sub: withCalls.length ? withCalls.map(family => `${family === 'claude' ? 'Claude' : 'OpenAI'} ${pct(100 * (kept(family).keptRate ?? 0))}`).join(' · ') : 'no AI answer calls this week', status: 'none'},
    {label: 'Forms filled, this week', value: num(forms), sub: ['claude', 'openai'].map(family => `${family === 'claude' ? 'Claude' : 'OpenAI'} ${num(families?.[family]?.fills)}`).join(' · '), status: 'none'},
    {label: 'Learned recipes', value: num(count('verified')), sub: `${num(count('canary'))} canary · ${num(count('candidate'))} candidates`, status: 'none'},
  ];
}

// Reported forms: reports still waiting to be fetched, and the last 30 days (counts only; src/report-view.js).
async function reports(env) {
  const row = await first(env, "SELECT COUNT(*) AS n, SUM(status = 'new') AS waiting FROM form_reports");
  return [{label: 'Reported forms waiting', value: num(row?.waiting), sub: `${num(row?.n)} reported in the last 30 days`, status: 'none'}];
}

export const FORM_FILLING = {'/admin/reports': reports, '/admin/real-form-filling': realUsers, '/admin/lab-form-filling': lab, '/admin/benchmark-form-filling': benchmark, '/admin/form-learning': learning};
