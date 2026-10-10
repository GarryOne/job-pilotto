// Claude teaches the extension (owner, 10 Oct 2026; spec docs/superpowers/specs/2026-10-10-claude-finishes-stuck-pages.md part 5). When a takeover leaves the page filled further, the controls
// it filled that the extension had left are reported, by structural fingerprint only, as outcomes where the extension failed (no recipe): counts, no label, no value. The site lists such
// fingerprints (with their skeleton sample from lib/misses.js) as the proposer's targets, and a recipe that passes the canary lets the next install meeting that shape fill it alone.
// Keyed by the application's session URL. Guarded by test/takeover-teach.test.js; the report path by test/recipes.test.js.
const runs = new Map();       // started takeovers: key -> {left: Set of normalized labels, host, taught: Set}
const lastSeen = new Map();   // the latest report per key: {pending: labels the extension left, host}
const norm = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const hostOf = url => { try { return new URL(String(url)).hostname; } catch { return ''; } };

export const pageKeyOf = url => String(url || '').split('#')[0].replace(/\/+$/, '').toLowerCase();
export const _reset = () => { runs.clear(); lastSeen.clear(); };
// Every review report of a session: what the extension had left, and where.
export function noteReport(key, payload) {
  if (!key || !Array.isArray(payload?.pending)) return;
  lastSeen.set(key, {pending: payload.pending.map(norm).filter(Boolean), host: hostOf(payload.url)});
}
// Claude was started on this application: what was left right now is what it may teach. False when no report gives that.
export function startRun(key) {
  const seen = lastSeen.get(key);
  if (!seen || !seen.pending.length) return false;
  runs.set(key, {left: new Set(seen.pending), host: seen.host, taught: new Set()});
  return true;
}
// A later report: the fields of that run that are filled now, reported once each. deps: {misses (lib/misses.js entries), report (reporter.outcome), log}. -> how many fingerprints.
export function observe(key, payload, {misses, report, log}) {
  const run = runs.get(key);
  if (!run || !Array.isArray(payload?.filled)) return 0;
  const filled = new Set(payload.filled.map(norm));
  const items = [];
  for (const label of run.left) {
    if (!filled.has(label) || run.taught.has(label)) continue;
    run.taught.add(label);
    for (const entry of misses) if (entry.hosts?.includes(run.host) && (entry.questions || []).some(question => norm(question) === label)) items.push({fp: entry.fingerprint, ok: false, recipe: 0});
  }
  if (!items.length) return 0;
  report(items);
  log('review', `takeover taught ${items.length} control(s): the extension left them, Claude filled them`, {host: run.host, fingerprints: items.map(item => item.fp)});
  return items.length;
}
