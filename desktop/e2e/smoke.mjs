#!/usr/bin/env node
// Layer 3, the nightly live smoke (spec: docs/superpowers/specs/2026-10-10-applying-reliability-layers.md). For each shape of smoke-sites.json: one of the owner's
// postings (read-only from the app's jobs.sqlite, rotating by day), run live through the e2e app with the real extension (the `npm run live` machinery,
// headless, HELD: no account button, never Submit), read where it got to (lib/smoke.mjs parseLive), compare with the last report, and list the boards the
// fleet digest flags as dropped (layer 4). Report: smoke-reports/<day>.json (not committed). Exit 1 when a shape reached less than last time.
// Usage: cd desktop/e2e && npm run smoke [-- --only <shape words> | --all] [SMOKE_PER_NIGHT=10] [SMOKE_SECONDS=90]: tonight's share of the pool (rotating), or
// --all / --only. Each shape is compared with ITS last run, however many nights ago. It never schedules itself (the owner chooses).
import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compare, lastSeen, parseLive, pickPosting, tonight} from './lib/smoke.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPORTS = path.join(here, 'smoke-reports');
export const LOCAL_SITES = process.env.SMOKE_SITES || path.join(os.homedir(), 'Library/Application Support/Job Pilotto/smoke-sites.json');   // never in the repo
const JOBS_DB = path.join(os.homedir(), 'Library/Application Support/Job Pilotto/data/jobs.sqlite');

export function postingsLike(likes, run = execFileSync) {
  const where = likes.map(like => `jobs.url like '${String(like).replace(/'/g, "''")}'`).join(' or ');
  const out = run('sqlite3', ['-readonly', '-separator', '\t', JOBS_DB, `select jobs.url, jobs.title, companies.name from jobs join companies on companies.id = jobs.company_id where ${where} order by jobs.url limit 40`], {encoding: 'utf8'});
  return String(out).split('\n').filter(Boolean).map(line => { const [url, title, company] = line.split('\t'); return {url, title, company}; });
}

// The posting still exists (by its HTTP status only: 404/410 = gone). A gone posting is noted, never counted as a regression.
export async function postingStatus(url, fetcher = fetch) {
  try { const answer = await fetcher(url, {method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20000)}); return answer.status; } catch { return 0; }
}

function liveRun(posting, seconds) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn('node', ['run-all.mjs', '--only', 'applyflows'], {cwd: here, env: {...process.env, LIVE: '1', LIVE_URL: posting.url, LIVE_TITLE: posting.title || '', LIVE_COMPANY: posting.company || '', LIVE_SECONDS: String(seconds)}});
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('close', code => resolve({output, code, seconds: Math.round((Date.now() - started) / 1000)}));
  });
}

function droppedBoards() {
  try {
    const key = execFileSync('security', ['find-generic-password', '-s', 'job-pilotto.site.api_key', '-w'], {encoding: 'utf8'}).trim();   // never printed
    const json = execFileSync('curl', ['-s', '--max-time', '20', '-H', `Authorization: Bearer ${key}`, 'https://www.jobpilotto.workers.dev/admin/form-filling/digest.json'], {encoding: 'utf8'});
    return (JSON.parse(json).boards || []).filter(board => board.dropped).map(board => ({board: board.board, earlier: board.earlierFilledShare, recent: board.recentFilledShare}));
  } catch { return null; }   // no key or no network: the report says the fleet was not read
}

async function main() {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
  const seconds = Number(process.env.SMOKE_SECONDS || 90);
  // smoke-sites.json is public (job-feed postings only); this Mac's postings copied from the owner's profiles live outside the repo, in the app's folder.
  const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).shapes || []; } catch { return []; } };
  const shapes = [...read(path.join(here, 'smoke-sites.json')), ...read(LOCAL_SITES)];
  const day = new Date().toISOString().slice(0, 10), results = {};
  const pool = shapes.filter(item => !only || item.shape.includes(only));
  const chosen = only || process.argv.includes('--all') ? pool : tonight(pool, Number(process.env.SMOKE_PER_NIGHT || 10));
  console.log(`smoke: ${chosen.length} of ${shapes.length} shapes tonight`);
  for (const {shape, like = [], urls = []} of chosen) {
    const posting = pickPosting([...urls.map(url => ({url, title: '', company: ''})), ...(like.length ? postingsLike(like) : [])]);
    if (!posting) { results[shape] = {reached: 'none', note: 'no posting of this shape in the job list'}; console.log(`smoke: ${shape}: no posting`); continue; }
    const status = await postingStatus(posting.url);
    if (status === 404 || status === 410) { results[shape] = {url: posting.url, reached: 'none', note: `posting gone (HTTP ${status})`}; console.log(`smoke: ${shape}: posting gone (HTTP ${status}): replace it in smoke-sites.json`); continue; }
    console.log(`smoke: ${shape}: ${posting.url} (HELD: no account button, never Submit; ~${seconds}s)`);
    const run = await liveRun(posting, seconds);
    results[shape] = {url: posting.url, ...parseLive(run.output), exit: run.code, seconds: run.seconds};
    fs.mkdirSync(REPORTS, {recursive: true});
    fs.writeFileSync(path.join(REPORTS, `${day}-${shape.replace(/\W+/g, '-')}.log`), run.output);
    console.log(`smoke: ${shape}: reached ${results[shape].reached}${results[shape].filled != null ? `, ${results[shape].filled} filled, ${results[shape].left} left` : ''} (${run.seconds}s)`);
  }
  const earlierReports = fs.existsSync(REPORTS) ? fs.readdirSync(REPORTS).filter(name => /^\d{4}-\d\d-\d\d\.json$/.test(name) && name < `${day}.json`)
    .map(name => { try { return JSON.parse(fs.readFileSync(path.join(REPORTS, name), 'utf8')); } catch { return null; } }).filter(Boolean) : [];
  const previous = lastSeen(earlierReports), previousFile = earlierReports.length ? `${earlierReports.length} earlier report(s)` : null;
  const regressions = compare(previous, results), dropped = droppedBoards();
  fs.mkdirSync(REPORTS, {recursive: true});
  fs.writeFileSync(path.join(REPORTS, `${day}.json`), `${JSON.stringify({day, results, regressions, dropped, comparedWith: previousFile}, null, 1)}\n`);
  console.log(`smoke: ${regressions.length ? `REGRESSIONS: ${regressions.map(item => `${item.shape} (${item.why})`).join('; ')}` : 'no regression'}${previousFile ? ` vs ${previousFile}` : ' (first report)'}`);
  console.log(`smoke: fleet boards dropped: ${dropped == null ? 'not read' : dropped.length ? dropped.map(item => `${item.board} ${item.earlier}→${item.recent}`).join(', ') : 'none'}`);
  console.log(`smoke: report ${path.join(REPORTS, `${day}.json`)}`);
  return regressions.length ? 1 : 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await main());
