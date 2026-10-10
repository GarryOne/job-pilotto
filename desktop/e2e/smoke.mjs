#!/usr/bin/env node
// Layer 3, the nightly live smoke (spec: docs/superpowers/specs/2026-10-10-applying-reliability-layers.md). For each shape of smoke-sites.json: one of the owner's
// postings (read-only from the app's jobs.sqlite, rotating by day), run live through the e2e app with the real extension (the `npm run live` machinery,
// headless, HELD: no account button, never Submit), read where it got to (lib/smoke.mjs parseLive), compare with the last report, and list the boards the
// fleet digest flags as dropped (layer 4). Report: <QA folder>/smoke-reports/<day>.json (outside the repo: it names real postings, and outlives worktrees). Exit 1 when a shape reached less than last time.
// Usage: cd desktop/e2e && npm run smoke [-- --only <shape words> | --all] [SMOKE_PER_NIGHT=10] [SMOKE_SECONDS=90]: tonight's share of the pool (rotating), or
// --all / --only. Each shape is compared with ITS last run, however many nights ago. It never schedules itself (the owner chooses).
import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compare, lastSeen, marksBlind, parseLive, pickPosting, placeFound, rungFields, shortfall, signature, tonight, verdictFields} from './lib/smoke.mjs';
import {hostOnly, ping, poolRows, upload} from './lib/applying-report.mjs';
import {poolCard, sendPoolCard} from './lib/pool-card.mjs';
import {earlierReports, recordSite} from './lib/smoke-record.mjs';
import {evidenceLines, runFinished, writeBundle} from './lib/evidence-bundle.mjs';
import {dropCandidate, saveCandidate} from './lib/replay-candidate.mjs';
import {fetchWanted, wantedFirst} from './lib/wanted-hosts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const QA_DIR = path.join(os.homedir(), 'Library/Application Support/Job Pilotto QA');   // survives profile resets and removed worktrees
const REPORTS = process.env.SMOKE_REPORTS || path.join(QA_DIR, 'smoke-reports');
const CANDIDATES = process.env.SMOKE_CANDIDATES || path.join(QA_DIR, 'replay-candidates');   // failing shapes' pages, scrubbed: on this Mac, never in the repo (lib/replay-candidate.mjs)
export const LOCAL_SITES = process.env.SMOKE_SITES || path.join(QA_DIR, 'smoke-sites.json');   // never in the repo, nor in the app's folder (a profile reset wipes that: 10 Oct 2026)
const JOBS_DB = path.join(os.homedir(), 'Library/Application Support/Job Pilotto/data/jobs.sqlite');

export function postingsLike(likes, run = execFileSync, limit = 40) {
  const where = likes.map(like => `jobs.url like '${String(like).replace(/'/g, "''")}'`).join(' or ');
  const out = run('sqlite3', ['-readonly', '-separator', '\t', JOBS_DB, `select jobs.url, jobs.title, companies.name from jobs join companies on companies.id = jobs.company_id where ${where} order by jobs.url limit ${Number(limit) || 40}`], {encoding: 'utf8'});
  return String(out).split('\n').filter(Boolean).map(line => { const [url, title, company] = line.split('\t'); return {url, title, company}; });
}

// The posting still exists (by its HTTP status only: 404/410 = gone). A gone posting is noted, never counted as a regression.
export async function postingStatus(url, fetcher = fetch) {
  try { const answer = await fetcher(url, {method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20000)}); return answer.status; } catch { return 0; }
}

function liveRun(posting, seconds, captureDir = '') {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn('node', ['run-all.mjs', '--only', 'applyflows'], {cwd: here, env: {...process.env, LIVE: '1', LIVE_URL: posting.url, LIVE_TITLE: posting.title || '', LIVE_COMPANY: posting.company || '', LIVE_SECONDS: String(seconds), LIVE_CAPTURE_DIR: captureDir, LIVE_ENGINE: process.env.LIVE_ENGINE || 'cli'}});
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('close', (code, signal) => resolve({output, code, signal, seconds: Math.round((Date.now() - started) / 1000)}));
  });
}

// The whole pool to /admin/applying, also sites never run: each shape's newest known flow signature (this run, else the last report, else the one stored with it).
const sendPool = (shapes, reports, results = {}) => upload('pool', poolRows(shapes, {...Object.fromEntries(shapes.filter(item => item.signature).map(item => [item.shape, item.signature])),
  ...Object.fromEntries(Object.entries(lastSeen(reports)).map(([shape, item]) => [shape, item.signature])), ...Object.fromEntries(Object.entries(results).map(([shape, item]) => [shape, item.signature]))}));

function droppedBoards() {
  try {
    const key = execFileSync('security', ['find-generic-password', '-s', 'job-pilotto.site.api_key', '-w'], {encoding: 'utf8'}).trim();   // never printed
    const json = execFileSync('curl', ['-s', '--max-time', '20', '-H', `Authorization: Bearer ${key}`, 'https://www.jobpilotto.top/admin/form-filling/digest.json'], {encoding: 'utf8'});
    return (JSON.parse(json).boards || []).filter(board => board.dropped).map(board => ({board: board.board, earlier: board.earlierFilledShare, recent: board.recentFilledShare}));
  } catch { return null; }   // no key or no network: the report says the fleet was not read
}

// --discover [--limit N]: candidates from the loaded profile's jobs (a few per host, more from job boards; none already in the pool), each run once live
// (held); one that shows a flow signature the pool does not have joins this Mac's list as a new shape. Its report: <QA folder>/smoke-reports/discover-<day>.json.
async function discover(limit) {
  const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {shapes: []}; } };
  const local = read(LOCAL_SITES), pool = [...read(path.join(here, 'smoke-sites.json')).shapes, ...local.shapes];
  const knownUrls = new Set(pool.flatMap(item => item.urls || []));
  const reports = fs.existsSync(REPORTS) ? fs.readdirSync(REPORTS).filter(name => /^\d{4}-\d\d-\d\d\.json$/.test(name)).map(name => read(path.join(REPORTS, name))) : [];
  const knownSignatures = new Set([...pool.map(item => item.signature), ...Object.values(lastSeen(reports)).map(item => item.signature)].filter(Boolean));
  const jobs = postingsLike(['http%'], undefined, 3000).filter(item => !/mail\.google\./.test(item.url));
  const day = new Date().toISOString().slice(0, 10), reportFile = path.join(REPORTS, `discover-${day}.json`);
  const seen = [...(read(reportFile).seen || [])];   // a restart the same day carries on: what the report already holds is not visited again (a stopped run used to start over, 10 Oct 2026)
  const wanted = await fetchWanted(), ordered = wantedFirst(jobs, wanted.hosts, new Set([...knownUrls, ...seen.map(item => item.url)]));   // hosts real users apply on that the pool lacks come first (lib/wanted-hosts.mjs)
  const chosen = ordered.chosen.slice(0, limit);
  const save = () => { fs.mkdirSync(REPORTS, {recursive: true}); fs.writeFileSync(reportFile, `${JSON.stringify({day, seen, suggested: wanted.hosts.map(item => item.host), noPosting: ordered.missing}, null, 1)}\n`); };   // after every candidate, not only at the end
  console.log(`smoke discover: ${wanted.hosts.length} suggested host(s) from real use${wanted.why ? ` (${wanted.why})` : ''}${ordered.missing.length ? `; no posting among your jobs for: ${ordered.missing.join(', ')}` : ''}`);
  console.log(`smoke discover: ${chosen.length} candidate(s) from ${jobs.length} job(s); ${knownSignatures.size} signature(s) already in the pool`);
  for (const posting of chosen) {
    const status = await postingStatus(posting.url);
    if (status === 404 || status === 410) { seen.push({url: posting.url, note: `gone (HTTP ${status})`}); save(); continue; }
    const run = await liveRun(posting, Number(process.env.SMOKE_SECONDS || 90)), result = parseLive(run.output), flow = signature(result);
    const fresh = result.reached !== 'none' && flow !== 'unclear' && !knownSignatures.has(flow);   // an unclear run teaches nothing: listed for the twin loop, not added
    seen.push({url: posting.url, signature: flow, reached: result.reached, added: fresh});
    save();
    console.log(`smoke discover: ${flow} ${fresh ? 'NEW: added to the pool' : 'known'} (${hostOnly(posting.url)})`);
    if (fresh) {
      knownSignatures.add(flow);
      placeFound(local.shapes, posting, flow, day);
      fs.mkdirSync(path.dirname(LOCAL_SITES), {recursive: true});
      fs.writeFileSync(LOCAL_SITES, `${JSON.stringify(local, null, 1)}\n`);
      // the page follows each find, not only the end of the run: a run that stops early (session closed, 10 Oct 2026) used to leave the page behind
      try { console.log(`smoke discover: ${await sendPool([...read(path.join(here, 'smoke-sites.json')).shapes, ...local.shapes], reports)}`); } catch (error) { console.log(`smoke discover: upload failed, the run goes on (${String(error?.message || error).slice(0, 120)})`); }
    }
  }
  save();
  console.log(`smoke discover: ${seen.filter(item => item.added).length} new shape(s) added to ${LOCAL_SITES}`);
  console.log(`smoke discover: ${await sendPool([...read(path.join(here, 'smoke-sites.json')).shapes, ...local.shapes], reports)}`);
  return 0;
}

async function main() {
  if (process.argv.includes('--discover')) return discover(Number(process.argv[process.argv.indexOf('--limit') + 1]) || 30);
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
  const seconds = Number(process.env.SMOKE_SECONDS || 90);
  // smoke-sites.json is public (job-feed postings only); this Mac's postings copied from the owner's profiles live outside the repo, in a QA folder the app never resets.
  const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).shapes || []; } catch { return []; } };
  const shapes = [...read(path.join(here, 'smoke-sites.json')), ...read(LOCAL_SITES)];
  const day = new Date().toISOString().slice(0, 10), results = {}, earlierList = earlierReports(REPORTS, day), previous = lastSeen(earlierList);
  // Each site is saved to the day's report and sent to /admin/applying the moment it ends, so stopping a run loses only the site in progress (lib/smoke-record.mjs).
  const finish = async shape => {
    const item = results[shape], found = recordSite({dir: REPORTS, day, shape, result: item, earlier: previous});
    console.log(`smoke: ${shape}: ${await sendPoolCard(poolCard(shape, item, {day}))}`);   // the same loop users' fills feed (lib/pool-card.mjs)
    console.log(`smoke: ${await upload('smoke', [{name: shape, host: hostOnly(item.url), reached: item.reached, filled: item.filled, left: item.left, note: item.note || '', regression: !!found, ...rungFields(item), ...verdictFields(item)}])}`);
  };
  const pool = shapes.filter(item => !only || item.shape.includes(only));
  const chosen = only || process.argv.includes('--all') ? pool : tonight(pool, Number(process.env.SMOKE_PER_NIGHT || 10));
  console.log(`smoke: ${chosen.length} of ${shapes.length} shapes tonight`);
  for (const {shape, like = [], urls = []} of chosen) {
    const posting = pickPosting([...urls.map(url => ({url, title: '', company: ''})), ...(like.length ? postingsLike(like) : [])]);
    if (!posting) { results[shape] = {reached: 'none', note: 'no posting of this shape in the job list'}; console.log(`smoke: ${shape}: no posting`); await finish(shape); continue; }
    const status = await postingStatus(posting.url);
    if (status === 404 || status === 410) { results[shape] = {url: posting.url, reached: 'none', note: `posting gone (HTTP ${status})`}; console.log(`smoke: ${shape}: posting gone (HTTP ${status}): replace it in smoke-sites.json`); await finish(shape); continue; }
    console.log(`smoke: ${shape}: ${posting.url} (HELD: no account button, never Submit; ~${seconds}s)`);
    await ping(shape, 'start');
    const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-capture-'));
    const run = await liveRun(posting, seconds, captureDir).finally(() => ping(shape, 'end'));
    if (!runFinished(run)) {   // killed or cut short (eb's 23 s Datadog row, 11 Oct 2026): nothing is recorded, uploaded or saved as a candidate
      fs.rmSync(captureDir, {recursive: true, force: true});
      console.log(`smoke: ${shape}: the run did not finish (${run.signal ? `killed by ${run.signal}` : `no end of the watch, exit ${run.code}`}, ${run.seconds}s): nothing recorded, nothing uploaded`);
      continue;
    }
    results[shape] = {url: posting.url, ...parseLive(run.output), exit: run.code, seconds: run.seconds};
    results[shape].signature = signature(results[shape]);
    results[shape].marksBlind = marksBlind(results[shape]);
    results[shape].short = shortfall(results[shape]);   // reached the form but filled under half: a failure the step alone hides
    fs.mkdirSync(REPORTS, {recursive: true});
    fs.writeFileSync(path.join(REPORTS, `${day}-${shape.replace(/\W+/g, '-')}.log`), run.output);
    // A failed run keeps its last page as a replay candidate (the owner's question "did we save a site replay?": no); a run that passed drops an older candidate of the day.
    const html = (() => { try { return fs.readFileSync(path.join(captureDir, 'page.html'), 'utf8'); } catch { return ''; } })();
    try { fs.writeFileSync(path.join(REPORTS, `${day}-${shape.replace(/\W+/g, '-')}.app.log`), fs.readFileSync(path.join(captureDir, 'app.log'), 'utf8')); } catch { /* no app log kept: the run did not get that far */ }
    const aiCalls = (() => { try { return fs.readFileSync(path.join(captureDir, 'ai-calls.json'), 'utf8'); } catch { return ''; } })();   // the app's live page-kind calls (desktop/lib/live-capture.js)
    const appLog = (() => { try { return fs.readFileSync(path.join(captureDir, 'app.log'), 'utf8'); } catch { return ''; } })();
    results[shape].evidence = path.relative(REPORTS, writeBundle({dir: path.join(REPORTS, 'evidence'), day, shape, output: run.output, appLog, aiCalls, result: results[shape]}));   // one bundle per shape (lib/evidence-bundle.mjs)
    results[shape].lines = evidenceLines(appLog);   // the four lines that matter, quoted in the day's report
    console.log(`smoke: ${shape}: evidence ${path.join(REPORTS, results[shape].evidence, 'evidence.md')}`);
    const kept = saveCandidate({dir: CANDIDATES, day, shape, result: results[shape], html, output: run.output, aiCalls});
    if (kept) console.log(`smoke: ${shape}: replay candidate saved in ${kept}`); else dropCandidate({dir: CANDIDATES, day, shape});
    fs.rmSync(captureDir, {recursive: true, force: true});
    console.log(`smoke: ${shape}: reached ${results[shape].reached}${results[shape].filled != null ? `, ${results[shape].filled} filled, ${results[shape].left} left` : ''} (${run.seconds}s)`);
    if (results[shape].marksBlind) console.log(`smoke: ${shape}: MARKS BLIND ${results[shape].marksBlind.starred} labels marked "*", ${results[shape].marksBlind.required} counted required: the required rule missed a layout`);
    if (results[shape].short) console.log(`smoke: ${shape}: SHORTFALL ${results[shape].short.miss} missed and ${results[shape].short.noSuggestion} with no suggestion, of ${results[shape].short.total} asked fields (${results[shape].short.done} filled or expected)`);
    await finish(shape);
    try { await sendPool(shapes, earlierList, results); } catch (error) { console.log(`smoke: pool upload failed, the run goes on (${String(error?.message || error).slice(0, 100)})`); }   // the page follows each site (its flow too), not only the run's end
  }
  const previousFile = earlierList.length ? `${earlierList.length} earlier report(s)` : null;
  const regressions = compare(previous, results), dropped = droppedBoards();
  fs.mkdirSync(REPORTS, {recursive: true});
  const saved = (() => { try { return JSON.parse(fs.readFileSync(path.join(REPORTS, `${day}.json`), 'utf8')); } catch { return {}; } })();   // what this run and the day's other runs saved site by site
  fs.writeFileSync(path.join(REPORTS, `${day}.json`), `${JSON.stringify({...saved, day, results: {...saved.results, ...results}, regressions, dropped, comparedWith: previousFile}, null, 1)}\n`);
  console.log(`smoke: ${regressions.length ? `REGRESSIONS: ${regressions.map(item => `${item.shape} (${item.why})`).join('; ')}` : 'no regression'}${previousFile ? ` vs ${previousFile}` : ' (first report)'}`);
  const blindMarks = Object.entries(results).filter(([, item]) => item.marksBlind);
  console.log(`smoke: ${blindMarks.length ? `MARKS BLIND (more "*" labels than required questions counted): ${blindMarks.map(([name, item]) => `${name} (${item.marksBlind.starred} vs ${item.marksBlind.required})`).join('; ')}` : 'no marks blind spot'}`);
  const shorts = Object.entries(results).filter(([, item]) => item.short);
  console.log(`smoke: ${shorts.length ? `SHORTFALLS (reached the form, under half filled): ${shorts.map(([name, item]) => `${name} (${item.short.miss + item.short.noSuggestion} unexplained of ${item.short.total})`).join('; ')}` : 'no shortfall'}`);
  console.log(`smoke: fleet boards dropped: ${dropped == null ? 'not read' : dropped.length ? dropped.map(item => `${item.board} ${item.earlier}→${item.recent}`).join(', ') : 'none'}`);
  console.log(`smoke: report ${path.join(REPORTS, `${day}.json`)}`);
  console.log(`smoke: ${await sendPool(shapes, earlierList, results)}`);
  return regressions.length ? 1 : 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await main());
