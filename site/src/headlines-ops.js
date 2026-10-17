// Headline numbers of the Operations/Engineering pages: Self-healing, Sentry, AI cost, PR checks, Build log, E2E (src/headlines.js draws them on the section's Overview).
// Each loader reads what its page already has (one snapshot row, or the same rows/cache), never a new table scan. Statuses: good/warn/bad where a rule exists (written next to it), none where a number is only activity.
import {byWeek, dayOf, since, sum} from './admin.js';
import {issues, fixer} from './sentry.js';
import {read, summarize} from './jobcost.js';

const first = async (env, sql, ...binds) => { try { return env.STATS ? await env.STATS.prepare(sql).bind(...binds).first() : null; } catch { return null; } };
const all = async (env, sql, ...binds) => { try { return env.STATS ? (await env.STATS.prepare(sql).bind(...binds).all()).results || [] : []; } catch { return []; } };
const json = text => { try { return JSON.parse(text) || {}; } catch { return {}; } };
const num = value => (Number(value) || 0).toLocaleString('en-US', {maximumFractionDigits: 0});

// Self-healing: the newest daily snapshot (what /admin/self-healing shows as "The loop, live") and the weekly precision from the stored days.
async function selfHealing(env, now) {
  const rows = (await all(env, 'SELECT day, body FROM selfheal_snapshots WHERE day >= ? ORDER BY day', since(now))).map(row => ({day: row.day, ...json(row.body)}));
  const live = rows.at(-1);
  if (!live) return [{label: 'Self-healing precision', value: 'No data', sub: 'the loop publishes every 3 hours from CI', status: 'none'}];
  const t = live.totals || {}, fix = live.fixer || {}, recall = live.recall;
  const judged = t.judged ?? (t.real || 0) + (t.falsePositive || 0);
  const precision = t.precision == null ? null : Math.round(t.precision);   // stored as a percent
  const weekly = byWeek(rows.filter(row => row.totals?.precision != null).map(row => ({day: row.day, p: row.totals.precision})), now, list => (list.length ? list.at(-1).p : null));
  return [
    // good from 50%, warn from 30%: below that the Finder files more noise than bugs.
    {label: 'Self-healing precision', value: precision == null ? '–' : `${precision}%`, sub: `${num(t.real)} real of ${num(judged)} judged${recall?.missed?.length ? ` · missed ${recall.missed.join(', ')}` : ''}`,
      status: precision == null ? 'none' : precision >= 50 ? 'good' : precision >= 30 ? 'warn' : 'bad', series: weekly, format: v => `${Math.round(v)}%`},
    {label: 'Fixer landed', value: num(fix.landed ?? fix.merged), sub: `${num(fix.opened)} PRs · ${num(fix.open)} open`, status: fix.open ? 'warn' : 'good'},
  ];
}

// Sentry: the live issues (cached 5 minutes, as the page) and the fixer's open fixes. 0 unresolved is good, up to 19 warn, more is bad.
async function sentry(env) {
  if (!env.SENTRY_AUTH_TOKEN) return [{label: 'Sentry unresolved', value: '–', sub: 'no Sentry token on the Worker', status: 'none'}];
  const [list, fix] = await Promise.all([issues(env, 'users'), fixer(env)]);
  const open = fix.pulls.filter(pr => pr.state === 'open').length, users = list.reduce((total, item) => total + (Number(item.userCount) || 0), 0);
  return [{label: 'Sentry unresolved', value: num(list.length), sub: `${num(users)} users hit · ${open} fix${open === 1 ? '' : 'es'} to review`, status: list.length === 0 ? 'good' : list.length < 20 ? 'warn' : 'bad'}];
}

// AI cost: today, the 30-day total and per day (the page's own summary); warn when today is over 1.5x the daily average and more than $1 above it.
async function aiCost(env, now) {
  const {runs, billed} = await read(env), s = summarize(runs, billed, now, '30d');
  const weekly = byWeek(runs, now, sum('usd'));
  const over = s.perDay > 0 && s.today > 1.5 * s.perDay && s.today - s.perDay > 1;
  return [{label: 'AI cost today', value: `$${s.today.toFixed(2)}`, sub: `$${s.total.toFixed(2)} in 30 days · $${s.perDay.toFixed(2)} a day${s.billedTotal ? ` · billed $${s.billedTotal.toFixed(2)}${s.covered != null ? ` (jobs explain ${s.covered}%)` : ''}` : ''}`,
    status: over ? 'warn' : 'good', series: weekly, format: v => `$${v.toFixed(0)}`, higherIsBetter: false}];
}

// PR checks: the newest monthly scorecard; the number is the checks that caught nothing real (a check with 0 catches is flaky or idle).
async function prChecks(env) {
  const row = await first(env, 'SELECT month, card FROM pr_check_months ORDER BY month DESC LIMIT 1');
  if (!row) return [{label: 'PR checks', value: 'No data', sub: 'the first scorecard posts on the 1st of the month', status: 'none', placeholder: true}];
  const checks = json(row.card).checks || [], idle = checks.filter(check => !check.realCatches).length;
  return [{label: 'PR checks with no real catch', value: `${idle} of ${checks.length}`, sub: `scorecard ${row.month}`, status: idle === 0 ? 'good' : idle * 2 > checks.length ? 'bad' : 'warn'}];
}

// Build log: the PRs and goals of the newest day with a digest.
async function buildLog(env) {
  const row = await first(env, 'SELECT day, groups, numbers FROM digest_days ORDER BY day DESC LIMIT 1');
  if (!row) return [{label: 'Build log', value: 'No data', sub: 'no day written yet', status: 'none'}];
  const count = text => { try { const list = JSON.parse(text); return Array.isArray(list) ? list.length : 0; } catch { return 0; } }, prs = count(row.numbers), goals = count(row.groups);
  return [{label: `PRs built ${row.day === dayOf(new Date()) ? 'today' : row.day}`, value: num(prs), sub: `${goals} goal${goals === 1 ? '' : 's'}`, status: 'none'}];
}

// E2E (job-pilotto-5d's page, table e2e_snapshot id 1 {days:[{day,runs,reds}], fails:[{cause,n}]}): reds in the last 7 days of the runs, and the top cause.
async function e2e(env, now) {
  const row = await first(env, 'SELECT body FROM e2e_snapshot WHERE id = 1');
  if (!row) return [{label: 'E2E reds, 7 days', value: 'No data', sub: 'the E2E snapshot has not arrived yet', status: 'none', placeholder: true}];
  const body = json(row.body), from = dayOf(new Date(now.getTime() - 6 * 86400000));
  const days = (body.days || []).filter(item => item.day >= from), runs = days.reduce((t, d) => t + (d.runs || 0), 0), reds = days.reduce((t, d) => t + (d.reds || 0), 0);
  const causes = {};
  for (const item of body.fails || []) if (item.day >= from) causes[item.cause] = (causes[item.cause] || 0) + (item.n || 0);
  const top = Object.entries(causes).sort((a, b) => b[1] - a[1])[0];
  const share = runs ? reds / runs : 0;
  return [{label: 'E2E reds, 7 days', value: `${num(reds)} of ${num(runs)}`, sub: top ? `top cause: ${top[0]} (${top[1]})` : 'no failures', status: !runs ? 'none' : share < 0.1 ? 'good' : share < 0.3 ? 'warn' : 'bad'}];
}

export const OPERATIONS = {'/admin/operations/build-log': buildLog, '/admin/operations/pr-checks': prChecks, '/admin/operations/e2e': e2e, '/admin/self-healing': selfHealing, '/admin/sentry': sentry, '/admin/ai-cost': aiCost};
