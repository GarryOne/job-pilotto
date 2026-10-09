// The owner's page /admin/sentry: the app's unresolved Sentry issues (org job-pilotto, project job-pilotto-app, EU region), read live,
// and what the Sentry fixer (.github/workflows/sentry-fix.yml) did with each: a pull request, or a verdict that it needs no change.
// Needs SENTRY_AUTH_TOKEN (a read-only token, the fixer's: Keychain job-pilotto.sentry.auth_token); GITHUB_TOKEN/GITHUB_REPO as for /admin/e2e.
// Sentry answers are cached 5 minutes (the page is opened often; Sentry rate-limits). Guarded by test/sentry.test.js.
import {esc} from './stats.js';
import {viewer} from './auth.js';
import {filterLinks} from './admin.js';

const SENTRY = 'https://de.sentry.io/api/0', ORG = 'job-pilotto', PROJECT = 'job-pilotto-app';
const CACHE_SECONDS = 300;
// Who reported it: the installs (production) or everything, the end-to-end runs too.
export const SCOPES = [['users', 'users', '?scope=users'], ['all', 'all, with e2e runs', '?scope=all']];

async function cached(url, init, fetcher) {
  const cache = globalThis.caches?.default, key = cache && new Request(url);
  const hit = cache && await cache.match(key).catch(() => null);
  if (hit) return hit.json();
  const response = await fetcher(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  if (cache) await cache.put(key, new Response(body, {headers: {'Cache-Control': `max-age=${CACHE_SECONDS}`, 'Content-Type': 'application/json'}})).catch(() => {});
  return JSON.parse(body);
}

export async function issues(env, scope, fetcher = fetch) {
  const environment = scope === 'all' ? '' : '&environment=production';
  return cached(`${SENTRY}/projects/${ORG}/${PROJECT}/issues/?statsPeriod=14d&query=is:unresolved&sort=user&limit=50${environment}`,
    {headers: {Authorization: `Bearer ${env.SENTRY_AUTH_TOKEN}`}}, fetcher);
}

// The fixer's traces on GitHub: its pull requests (branch sentry-fix/<short id>), its verdict issues (title "Sentry fixer: <short id> <verdict>"), its last run.
export async function fixer(env, fetcher = fetch) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return {pulls: [], verdicts: [], run: null};
  const github = path => cached(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {headers: {Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json', 'User-Agent': 'job-pilotto-site'}}, fetcher).catch(() => null);
  const [pulls, verdicts, runs] = await Promise.all([github('/pulls?state=all&per_page=100'), github('/issues?labels=sentry-fix-verdict&state=all&per_page=100'),
    github('/actions/workflows/sentry-fix.yml/runs?per_page=1')]);
  return {pulls: (pulls || []).filter(pr => String(pr.head?.ref || '').startsWith('sentry-fix/')), verdicts: verdicts || [], run: runs?.workflow_runs?.[0] || null};
}

// One issue's fixer status: its pull request (newest), else its newest verdict, else nothing yet.
export function status(shortId, {pulls, verdicts}) {
  const id = String(shortId);
  const pr = pulls.find(item => item.head.ref === `sentry-fix/${id.toLowerCase()}`);
  if (pr) return {text: pr.merged_at ? 'fix merged' : pr.state === 'open' ? 'fix to review' : 'fix closed', url: pr.html_url, tone: pr.merged_at ? 'ok' : pr.state === 'open' ? 'warn' : ''};
  const verdict = verdicts.find(item => String(item.title).split(' ')[2] === id);
  if (verdict) return {text: String(verdict.title).split(' ')[3] || 'no change', url: verdict.html_url, tone: ''};
  return null;
}

const when = text => String(text || '').slice(0, 16).replace('T', ' ');
const LEVEL = {fatal: 'crash', error: 'error', warning: 'warning'};

export function page({list, fix, scope, error}) {
  const users = list.reduce((sum, item) => sum + (Number(item.userCount) || 0), 0), events = list.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
  const run = fix.run, open = fix.pulls.filter(pr => pr.state === 'open').length;
  const tiles = [['🐞 Unresolved issues', list.length, 'seen in the last 14 days'], ['👥 Users hit', users, 'summed over issues'], ['🔁 Events', events, ''],
    ['🛠️ Sentry fixer', run ? esc(run.conclusion || run.status) : '–', run ? `last run <a href="${esc(run.html_url)}">${esc(when(run.created_at))}</a> · ${open} fix${open === 1 ? '' : 'es'} to review` : 'no run found']];
  const rows = list.map(item => {
    const state = status(item.shortId, fix);
    return `<tr><td><span class="kind ${esc(item.level)}">${esc(LEVEL[item.level] || item.level)}</span></td>
    <td><a href="${esc(item.permalink)}">${esc(item.shortId)}</a> ${esc(String(item.title).slice(0, 220))}${item.culprit ? `<br><small class="muted">${esc(String(item.culprit).slice(0, 120))}</small>` : ''}</td>
    <td class="num"><b>${Number(item.userCount) || 0}</b></td><td class="num">${Number(item.count) || 0}</td><td class="muted">${esc(when(item.lastSeen))}</td>
    <td>${state ? `<a class="fix ${state.tone}" href="${esc(state.url)}">${esc(state.text)}</a>` : '<span class="muted">–</span>'}</td></tr>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Sentry · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
.sentry .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px}.sentry .tile b{display:block;font-size:32px;margin-top:4px}
.sentry .kind{font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px;background:#262c33;white-space:nowrap}
.sentry .kind.fatal{color:#e5776b}.sentry .kind.error{color:#f5b54a}.sentry .fix{white-space:nowrap}.sentry .fix.ok{color:#5ec4b6}.sentry .fix.warn{color:#f5b54a}.sentry td{overflow-wrap:anywhere}
</style></head><body><main class="sentry">
<header><h1>🐞 Sentry</h1><span class="muted">${filterLinks(SCOPES, scope)}</span></header>
${error ? `<section class="card"><b>Sentry can't be read: ${esc(error)}.</b> <span class="muted">Set the Worker secret: cd site && npx wrangler@4 secret put SENTRY_AUTH_TOKEN (Keychain job-pilotto.sentry.auth_token).</span></section>` : ''}
<div class="tiles">${tiles.map(([label, value, note]) => `<div class="card tile"><span class="muted">${label}</span><b>${value}</b>${note ? `<small class="muted">${note}</small>` : ''}</div>`).join('')}</div>
<section class="card"><h2>Issues, most users first</h2><table><tr><th>Level</th><th>Issue</th><th>Users</th><th>Events</th><th>Last</th><th>Fixer</th></tr>
${rows || `<tr><td colspan="6" class="muted">${error ? 'Nothing to show.' : 'No unresolved issues. 🎉'}</td></tr>`}</table>
<small class="muted" style="display:block;margin-top:8px">Fixer: the daily Sentry fixer's pull request for the issue, or its verdict when it judged no change is needed (left out for 14 days). <a href="https://job-pilotto.sentry.io/issues/">Open Sentry</a></small></section>
</main></body></html>`;
}

export async function view(request, env, fetcher = fetch) {
  if (!await viewer(request, env)) return new Response('Not found', {status: 404});
  const scope = new URL(request.url).searchParams.get('scope') === 'all' ? 'all' : 'users';
  let list = [], error = '';
  if (!env.SENTRY_AUTH_TOKEN) error = 'no SENTRY_AUTH_TOKEN';
  else list = await issues(env, scope, fetcher).catch(problem => { error = problem.message; return []; });
  const fix = await fixer(env, fetcher);
  return new Response(page({list: Array.isArray(list) ? list : [], fix, scope, error}), {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}
