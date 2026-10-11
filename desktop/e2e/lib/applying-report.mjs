// Uploads a run of the recorded pages (layer 2) or of the nightly smoke (layer 3) to the site's /admin/applying (site/src/applying.js), with the owner key from
// the Keychain (never printed). Fixed words and hosts only: never a posting's address, never applicant data. Never from CI, nor from a control run against an
// old build (REAL_EXTENSION_DIR: its failures are on purpose). Guard: e2e/test/applying-report.test.mjs.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const SITE = 'https://www.jobpilotto.top/admin/applying';
// desktop/e2e (not imported from app.mjs: that pulls playwright-core into the desktop unit job, which does not install it; main was red 11 Oct 2026).
const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const extensionVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(E2E, '..', '..', 'extension', 'manifest.json'), 'utf8')).version; } catch { return ''; } };
export const hostOnly = url => { try { return new URL(url).hostname; } catch { return ''; } };
export const skipReason = (env = process.env) => (env.CI ? 'CI' : env.REAL_EXTENSION_DIR ? 'a control run on another build' : env.JP_NO_REPORT ? 'JP_NO_REPORT' : '');

// The owner's site key from the Keychain (or the one given), '' when there is none. Never printed.
export function ownerKey(key) {
  if (key) return key;
  try { return execFileSync('security', ['find-generic-password', '-s', 'job-pilotto.site.api_key', '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { return ''; }
}

// A recorded case uploads only with its control (owner, 10 Oct 2026: a case that passed on the old build reached /admin/applying as a pass). case.json `control` is
// {build: <the older extension version it was seen failing on>, failed: <the check that failed>}, or {guard: <why it cannot fail on an old build>}. -> '' or why not.
const parts = text => (/^\d+(\.\d+)*$/.test(text || '') ? text.split('.').map(Number) : null);
const older = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0); } return false; };
export function controlProblem(item, current) {
  const control = item.control || {};
  if (typeof control.guard === 'string' && control.guard.trim()) return '';
  if (!control.build && !control.failed) return 'no control (case.json "control": {build, failed} seen on an older build, or {guard})';
  const build = parts(control.build), now = parts(current);
  if (!build) return 'control.build is not an extension version';
  if (!control.failed) return 'control has no failed check';
  return now && older(build, now) ? '' : `control.build ${control.build} is not older than this build ${current}`;
}
// The rows to send and the cases held back: {rows, held: [{name, why}]}.
export function uploadable(results, current) {
  const held = [], rows = [];
  for (const result of results) { const why = controlProblem(result, current); if (why) held.push({name: result.name, why}); else rows.push(result); }
  return {rows, held};
}

// -> a one-line outcome, for the run's own output.
export async function upload(kind, rows, {env = process.env, key, fetcher = fetch, day = new Date().toISOString().slice(0, 10)} = {}) {
  const why = skipReason(env);
  if (why) return `applying report: not sent (${why})`;
  const token = ownerKey(key);
  if (!token) return 'applying report: not sent (no site key in the Keychain)';
  try {
    const answer = await fetcher(SITE, {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({kind, day, version: extensionVersion(), rows}), signal: AbortSignal.timeout(20000)});
    const body = await answer.json().catch(() => ({}));
    return answer.ok ? `applying report: ${body.stored ?? 0} ${kind} row(s) sent to /admin/applying` : `applying report: refused (${answer.status} ${body.error || ''})`;
  } catch (error) { return `applying report: not sent (${String(error?.message || error).slice(0, 80)})`; }
}

// A site starts or ends its run ("start" | "end"): /admin/applying shows a spinner on its row while it runs. Only the site's name and a fixed word; never throws, so a run never fails on it.
export const ping = (name, state, options = {}) => upload('running', [{name, state}], options).catch(() => '');

// The pool as the site lists it ("The pool" table, site/src/applying.js): every site of the pool, also one never run, with its start host and, when a run showed it,
// its flow signature (page kinds @ end host # step). Hosts and fixed words only: a signature that is not exactly that is dropped, never sent.
const SIGNATURE = /^(unclear|[a-z-]+(>[a-z-]+)*@[a-z0-9.-]+#(none|posting|account|code\/bot|form|ready))$/;
export const poolRows = (shapes, signatures = {}) => shapes.map(({shape, urls = []}) => {
  const row = {name: shape}, host = hostOnly(urls[0] || ''), signature = signatures[shape];
  if (host) row.start_host = host;
  if (SIGNATURE.test(signature || '')) row.signature = signature;
  return row;
});
