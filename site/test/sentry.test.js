// The owner's Sentry page (src/sentry.js): live issues, most users first, each with what the Sentry fixer did; a missing token says how to set it.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {page, status, view} from '../src/sentry.js';

const ISSUES = [
  {shortId: 'JOB-PILOTTO-APP-3', title: 'run_failed · src.focus remind: --send requires TELEGRAM_CHAT_ID', level: 'error', count: '145', userCount: 4, lastSeen: '2026-10-09T12:00:00Z', permalink: 'https://job-pilotto.sentry.io/issues/3/', culprit: ''},
  {shortId: 'JOB-PILOTTO-APP-1V', title: "ImportError: cannot import name 'JOBLIST'", level: 'fatal', count: '1', userCount: 1, lastSeen: '2026-10-09T11:25:00Z', permalink: 'https://job-pilotto.sentry.io/issues/1v/', culprit: 'src/sources/visits.py in <module>'},
  {shortId: 'JOB-PILOTTO-APP-P', title: 'Error: recall planted rejection', level: 'fatal', count: '134', userCount: 1, lastSeen: '2026-10-09T12:20:00Z', permalink: 'https://job-pilotto.sentry.io/issues/p/', culprit: ''},
];
const FIX = {
  pulls: [{head: {ref: 'sentry-fix/job-pilotto-app-3'}, state: 'open', merged_at: null, html_url: 'https://github.com/x/pull/9'}, {head: {ref: 'other'}, state: 'open'}],
  verdicts: [{title: 'Sentry fixer: JOB-PILOTTO-APP-P not-a-bug', html_url: 'https://github.com/x/issues/10'}],
  run: {conclusion: 'success', created_at: '2026-10-09T06:30:00Z', html_url: 'https://github.com/x/actions/runs/1'},
};

test('each issue shows the fixer\'s pull request, its verdict, or nothing yet', () => {
  assert.deepEqual(status('JOB-PILOTTO-APP-3', FIX), {text: 'fix to review', url: 'https://github.com/x/pull/9', tone: 'warn'});
  assert.equal(status('JOB-PILOTTO-APP-P', FIX).text, 'not-a-bug');
  assert.equal(status('JOB-PILOTTO-APP-1V', FIX), null);
  assert.equal(status('JOB-PILOTTO-APP', FIX), null, 'a short id that starts another is not it');
});

test('the page lists every issue with its users, events, level and fixer state', () => {
  const html = page({list: ISSUES, fix: FIX, scope: 'users', error: ''});
  for (const item of ISSUES) assert.ok(html.includes(item.shortId) && html.includes(item.permalink), item.shortId);
  assert.match(html, /<b>4<\/b><\/td><td class="num">145<\/td>/);
  assert.match(html, /class="kind fatal">crash</);
  assert.match(html, /fix to review/);
  assert.match(html, /not-a-bug/);
  assert.match(html, /<b>6<\/b>/, 'users summed in the tile');
  assert.ok(!html.includes('<script'), 'no script of its own: the admin menu adds the shared one');
});

test('the owner only; Sentry is asked with the token, production by default, everything on ?scope=all', async () => {
  const asked = [];
  const fetcher = async (url, init) => { asked.push({url: String(url), auth: init?.headers?.Authorization}); return new Response(JSON.stringify(String(url).includes('sentry.io') ? ISSUES : [])); };
  const env = {SENTRY_AUTH_TOKEN: 'tok', STATS_KEY: 'k3y'};
  assert.equal((await view(new Request('https://x/admin/sentry'), env, fetcher)).status, 404);
  const own = path => new Request(`https://x${path}`, {headers: {Cookie: 'jp_stats=k3y'}});
  const html = await (await view(own('/admin/sentry'), env, fetcher)).text();
  assert.ok(html.includes('JOB-PILOTTO-APP-1V'));
  assert.match(asked[0].url, /environment=production/);
  assert.equal(asked[0].auth, 'Bearer tok');
  await view(own('/admin/sentry?scope=all'), env, fetcher);
  assert.doesNotMatch(asked.at(-1).url, /environment=/);
});

test('without the token or when Sentry fails, the page says why and how to fix it', async () => {
  assert.match(page({list: [], fix: {pulls: [], verdicts: [], run: null}, scope: 'users', error: 'no SENTRY_AUTH_TOKEN'}), /secret put SENTRY_AUTH_TOKEN/);
  const env = {SENTRY_AUTH_TOKEN: 'tok', STATS_KEY: 'k3y'};
  const html = await (await view(new Request('https://x/admin/sentry', {headers: {Cookie: 'jp_stats=k3y'}}), env, async () => new Response('no', {status: 401}))).text();
  assert.match(html, /Sentry can't be read: HTTP 401/);
});
