// Uploads a run of the recorded pages (layer 2) or of the nightly smoke (layer 3) to the site's /admin/applying (site/src/applying.js), with the owner key from
// the Keychain (never printed). Fixed words and hosts only: never a posting's address, never applicant data. Never from CI, nor from a control run against an
// old build (REAL_EXTENSION_DIR: its failures are on purpose). Guard: e2e/test/applying-report.test.mjs.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {E2E} from './app.mjs';

export const SITE = 'https://www.jobpilotto.top/admin/applying';
export const extensionVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(E2E, '..', '..', 'extension', 'manifest.json'), 'utf8')).version; } catch { return ''; } };
export const hostOnly = url => { try { return new URL(url).hostname; } catch { return ''; } };
export const skipReason = (env = process.env) => (env.CI ? 'CI' : env.REAL_EXTENSION_DIR ? 'a control run on another build' : env.JP_NO_REPORT ? 'JP_NO_REPORT' : '');

// -> a one-line outcome, for the run's own output.
export async function upload(kind, rows, {env = process.env, key, fetcher = fetch, day = new Date().toISOString().slice(0, 10)} = {}) {
  const why = skipReason(env);
  if (why) return `applying report: not sent (${why})`;
  let token = key;
  try { token ??= execFileSync('security', ['find-generic-password', '-s', 'job-pilotto.site.api_key', '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { token = ''; }
  if (!token) return 'applying report: not sent (no site key in the Keychain)';
  try {
    const answer = await fetcher(SITE, {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({kind, day, version: extensionVersion(), rows}), signal: AbortSignal.timeout(20000)});
    const body = await answer.json().catch(() => ({}));
    return answer.ok ? `applying report: ${body.stored ?? 0} ${kind} row(s) sent to /admin/applying` : `applying report: refused (${answer.status} ${body.error || ''})`;
  } catch (error) { return `applying report: not sent (${String(error?.message || error).slice(0, 80)})`; }
}

// The pool as the site lists it ("The pool" table, site/src/applying.js): every site of the pool, also one never run, with its start host and, when a run showed it,
// its flow signature (page kinds @ end host # step). Hosts and fixed words only: a signature that is not exactly that is dropped, never sent.
const SIGNATURE = /^(unclear|[a-z-]+(>[a-z-]+)*@[a-z0-9.-]+#(none|posting|account|code\/bot|form|ready))$/;
export const poolRows = (shapes, signatures = {}) => shapes.map(({shape, urls = []}) => {
  const row = {name: shape}, host = hostOnly(urls[0] || ''), signature = signatures[shape];
  if (host) row.start_host = host;
  if (SIGNATURE.test(signature || '')) row.signature = signature;
  return row;
});
