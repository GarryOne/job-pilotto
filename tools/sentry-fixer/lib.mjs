// The Sentry fixer's decisions, as pure functions (tested in desktop/test/sentry-fixer.test.js): which Sentry issues are worth a fix, which one is first, which files a fix may touch.
// Care taken against stale or false work: end-to-end runs report to Sentry too (environment `e2e`) and never count; a warning is the app telling the user something (a spend limit), not a bug;
// an issue not seen for a week is stale; one that already has a pull request (open, or closed/merged in the last 14 days) is left alone.

export const NOT_REAL_ENVIRONMENTS = ['e2e', 'test', 'dev', 'development', 'ci'];
export const FRESH_DAYS = 7;
export const COOLDOWN_DAYS = 14;
const DAY = 86400000;

// issue: Sentry's issue JSON ({shortId, level, status, count (a string), userCount, firstSeen, lastSeen, ...}); environment: its latest event's environment tag.
export function judge(issue, environment, now = Date.now()) {
  if (NOT_REAL_ENVIRONMENTS.includes(String(environment || '').toLowerCase())) return {ok: false, why: `reported by an ${environment} run, not a user`};
  if (issue.status && issue.status !== 'unresolved') return {ok: false, why: `already ${issue.status} in Sentry`};
  if (!['error', 'fatal'].includes(issue.level)) return {ok: false, why: `a ${issue.level}: the app telling the user something, not a bug`};
  const seen = Date.parse(issue.lastSeen);
  if (!Number.isFinite(seen) || now - seen > FRESH_DAYS * DAY) return {ok: false, why: `not seen for more than ${FRESH_DAYS} days: stale`};
  const count = Number(issue.count) || 0, users = Number(issue.userCount) || 0;
  if (issue.level !== 'fatal' && count < 3 && users < 2) return {ok: false, why: 'seen once by one person: a one-off until it comes back'};
  return {ok: true, why: ''};
}

// Most affected people first, then how often, then how recently.
export const score = issue => (Number(issue.userCount) || 0) * 1000 + Math.min(Number(issue.count) || 0, 999) + (issue.level === 'fatal' ? 5000 : 0);

// The pull requests of this fixer carry the branch `sentry-fix/<short id>`. prs: [{headRefName, state: OPEN|MERGED|CLOSED, closedAt, mergedAt}]
export function handled(shortId, prs, now = Date.now()) {
  const branch = `sentry-fix/${String(shortId).toLowerCase()}`;
  return prs.some(pr => pr.headRefName === branch && (pr.state === 'OPEN' || now - Date.parse(pr.mergedAt || pr.closedAt || 0) < COOLDOWN_DAYS * DAY));
}

// candidates: [{issue, environment}] -> the first fixable one, and why each other was left out.
export function choose(candidates, prs = [], now = Date.now()) {
  const left = [];
  const ready = candidates.filter(({issue, environment}) => {
    const verdict = judge(issue, environment, now);
    if (!verdict.ok) { left.push({shortId: issue.shortId, why: verdict.why}); return false; }
    if (handled(issue.shortId, prs, now)) { left.push({shortId: issue.shortId, why: 'already has a pull request'}); return false; }
    return true;
  }).sort((a, b) => score(b.issue) - score(a.issue));
  return {pick: ready[0] || null, left};
}

// What a fix may touch: the app's code and the engine, and their tests. Never what reports, secrets, licences or the build itself.
const ALLOWED = [/^desktop\/lib\/[^/]+\.js$/, /^desktop\/main\.js$/, /^desktop\/renderer\/.+/, /^src\/.+\.py$/, /^desktop\/test\/[^/]+\.test\.js$/, /^tests\/[^/]+\.py$/];
const FORBIDDEN = /(secret|license|licence|crash_reporting|telemetry|sentry|analytics|keychain|\.\.)/i;
const TEST = /^(desktop\/test\/[^/]+\.test\.js|tests\/[^/]+\.py)$/;
export function checkChange(files) {
  const bad = files.filter(file => !ALLOWED.some(pattern => pattern.test(file)) || FORBIDDEN.test(file));
  if (bad.length) return {ok: false, why: `edits outside what a fix may touch: ${bad.join(', ')}`};
  if (!files.some(file => TEST.test(file))) return {ok: false, why: 'a fix must come with a test'};
  return {ok: true, why: ''};
}

// The latest event, reduced to what a fix needs: the exception with its own code frames, the trail of steps, the release. No user, no install id.
export function eventFacts(event) {
  const tags = Object.fromEntries((event.tags || []).map(tag => [tag.key, tag.value]));
  const values = (event.entries || []).find(entry => entry.type === 'exception')?.data?.values || [];
  const exceptions = values.map(value => ({type: value.type, value: String(value.value || '').slice(0, 600),
    frames: (value.stacktrace?.frames || []).filter(frame => frame.inApp !== false).slice(-8).map(frame => ({file: frame.filename, line: frame.lineNo, function: frame.function, code: frame.context?.find(([n]) => n === frame.lineNo)?.[1]?.trim() || ''}))}));
  const trail = ((event.entries || []).find(entry => entry.type === 'breadcrumbs')?.data?.values || []).slice(-25).map(item => item.message || item.category || '').filter(Boolean);
  return {release: tags.release || '', environment: tags.environment || '', exceptions, trail, message: String(event.message || event.title || '').slice(0, 400)};
}
