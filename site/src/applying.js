// /admin/lab-form-filling: are applications reliable? Layers 2 and 3 of the applying reliability spec (docs/superpowers/specs/2026-10-10-applying-reliability-layers.md):
// the recorded pages (each case, passed or failed, by run) and the nightly live smoke (each site: the step it reached, its last runs, regressions), plus the
// fleet's dropped boards (layer 4, src/digest.js). The owner's Mac uploads each run (POST here, the owner key; desktop/e2e/lib/applying-report.mjs): the
// site's host and fixed words only, never a posting's address or applicant data. Guard: test/applying.test.js.
import {oneJudgment} from './applying-judgment.js';
import {testSets, whatWeTestSection} from './what-we-test.js';
import {leftEmpty, leftEmptySection} from './left-empty.js';
import {LEFT_EMPTY_CSS} from './left-empty-view.js';
import {viewer} from './auth.js';
import {FIX_KINDS, FIXED_CSS, FIXED_SCRIPT, fixedData, ingestFixes} from './applying-fixed.js';
import {ORDER_SOURCE, needsFixOrder} from './applying-order.js';
import {ARCHIVE_WHY, STAGE_DATA, STAGE_WORD, markStages, stageCounts} from './applying-stage.js';
import {TILE_RULE, tileTones} from './applying-tiles.js';
import {GROUPS_SOURCE} from './applying-groups.js';
import {digest} from './digest.js';
import {BARS_CSS} from './day-bars.js';
import {cachedJson, dropSnapshot, latestRuns, refreshLatest, slowCache} from './applying-store.js';
import {topCauses} from './applying-cause.js';
import {readReplays, replayCases} from './applying-replays.js';
import {CASES_SCRIPT} from './applying-cases.js';
import {LADDER_CSS, LADDER_SCRIPT} from './applying-ladder.js';
import {NIGHTS_SCRIPT} from './applying-nights.js';
import {COVERAGE_CSS, COVERAGE_SCRIPT} from './applying-coverage-view.js';
import {PAGETABS_CSS, PAGETABS_SCRIPT} from './applying-pagetabs.js';
import {WATCH_CSS, WATCH_SCRIPT} from './applying-watch.js';
import {RESOLUTION_CSS, RESOLUTION_SCRIPT, STEPS, causeWord, endingWord, readEndings, resolution as resolutionOf} from './applying-resolution.js';
import {FIDELITY_CSS, FIDELITY_SCRIPT, fidelity as fidelityOf, readFidelity} from './applying-fidelity.js';
import {STATES, STATE_WORD, isCleanHold, isHold, rowStatus} from './applying-status.js';
import {nextToAdd} from './nextsites.js';
import {platformScorecard} from './scorecard.js';
import {displayName, flowOf, platformLabel, SIGNATURE, signatureHost} from './platform.js';

export {STEPS};
const KINDS = ['smoke', 'pool', 'running'];   // 'recorded' comes from CI on main only (PUT /applying/replays, src/applying-replays.js)
const RUNNING_MINUTES = 5;   // a start ping older than this is a run that died
const DAY = /^\d{4}-\d\d-\d\d$/;
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const SIGNALS = ['unsure', 'contradicted', 'stalled', 'failed', 'blind'];   // why a rung handed the page on (the AI ladder spec): fixed words only
const rungOf = value => (Number.isInteger(value) && value >= 0 && value <= 6 ? value : null);
const int = value => (Number.isInteger(value) && value >= 0 && value < 10000 ? value : null);
const hostOf = value => { const host = text(value, 120).toLowerCase(); return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null; };

// -> {ok, stored} | {ok: false, error}. body: {kind, day, version, rows: [{name, start_host?, signature?} for 'pool'; {name, host?, reached?, filled?, left?, ok?, note?, regression?}]}
export async function ingest(db, body, now = new Date()) {
  const result = await ingestRows(db, body, now);
  if (result.ok) await dropSnapshot(db);   // the page's snapshot is recomputed on the next view (src/applying-store.js)
  return result;
}
async function ingestRows(db, body, now) {
  if (FIX_KINDS.includes(body?.kind)) return ingestFixes(db, body, now);   // the fix ledger and the claims: snapshots (src/applying-fixed.js)
  if (body?.kind === 'recorded') return {ok: false, error: 'the recorded replays come from CI on main only (PUT /applying/replays): a local run is not uploaded'};
  const kind = KINDS.includes(body?.kind) ? body.kind : null, day = DAY.test(body?.day || '') ? body.day : null;
  const rows = Array.isArray(body?.rows) ? body.rows.slice(0, 200) : [];
  if (!kind || !day || !rows.length) return {ok: false, error: 'kind, day and rows are required'};
  const version = text(body.version, 20) || null, at = now.toISOString(), onMain = body.onMain === true ? 1 : 0;   // the Mac's build is main's (migration 0061)
  let stored = 0;
  const touched = [];
  let known = null;   // the pool's rows as stored, read once per upload
  for (const row of rows) {
    const name = text(row?.name, 120);
    if (!name) continue;
    if (kind === 'running') {   // a site starts or ends its run: fixed words only
      if (row.state === 'start') await db.prepare('INSERT INTO applying_running (name, at) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET at = excluded.at').bind(name, at).run();
      else if (row.state === 'end') await db.prepare('DELETE FROM applying_running WHERE name = ?').bind(name).run();
      else continue;
      stored += 1; continue;
    }
    if (kind === 'pool') {   // a pool site: its start host and flow signature, fixed words only (a later row without them keeps what is known)
      const signature = SIGNATURE.test(text(row.signature, 200)) ? text(row.signature, 200) : null, start = hostOf(row.start_host), old = (known ||= await knownPool(db)).get(name);
      const stage = STAGE_DATA.includes(row.stage) ? row.stage : null, why = stage === 'archived' && ARCHIVE_WHY.includes(row.stage_why) ? row.stage_why : null;   // the row's life-cycle data: only these words
      if (old && old.version === version && (start == null || start === old.start_host) && (signature == null || signature === old.signature) && (old.stage ?? null) === stage && (old.stage_why ?? null) === why) continue;   // unchanged: nothing is written (the D1 write budget)
      await db.prepare(`INSERT INTO applying_pool (name, start_host, signature, at, version, stage, stage_why) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET
        start_host = COALESCE(excluded.start_host, start_host), signature = COALESCE(excluded.signature, signature), at = excluded.at, version = excluded.version, stage = excluded.stage, stage_why = excluded.stage_why`)
        .bind(name, start, signature, at, version, stage, why).run();
      stored += 1; continue;
    }
    await db.prepare(`INSERT INTO applying_runs (kind, day, at, name, host, reached, filled, left_n, ok, note, regression, version, rung, signal, asked, unexplained, ending, on_main, cause) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(kind, day, at, name, kind === 'smoke' ? hostOf(row.host) : null, kind === 'smoke' && STEPS.includes(row.reached) ? row.reached : null,
        int(row.filled), int(row.left), null, text(row.note, 200) || null, row.regression ? 1 : 0, version,
        rungOf(row.rung), kind === 'smoke' && SIGNALS.includes(row.signal) ? row.signal : null,
        kind === 'smoke' ? int(row.asked) : null, kind === 'smoke' ? int(row.unexplained) : null, kind === 'smoke' ? endingWord(row.ending) : null, kind === 'smoke' ? onMain : null, kind === 'smoke' ? causeWord(row.cause) : null).run();   // the run's ending, and whether main's build ran it (src/applying-resolution.js)
    touched.push({kind, name});
    stored += 1;
  }
  if (kind === 'pool') await syncRetired(db, rows, body.full === true, at);
  await refreshLatest(db, touched);
  return {ok: true, stored};
}

// A FULL pool upload (body.full, the uploader sends the whole pool list) is the pool's membership: a stored name it lacks was renamed or removed, so it leaves the pool table (hidden: its
// runs stay in the history). Names uploaded again come back. A partial upload never drops anything, and a "full" one holding under half the stored pool is ignored (a bad upload cannot empty the page).
async function syncRetired(db, rows, full, at) {
  const names = [...new Set(rows.map(row => text(row?.name, 120)).filter(Boolean))];
  for (const name of names) await db.prepare('DELETE FROM applying_pool_retired WHERE name = ?').bind(name).run();
  if (!full) return;
  const stored = ((await db.prepare('SELECT name FROM applying_pool').all()).results || []).map(row => row.name), listed = new Set(names);
  if (names.length < Math.ceil(stored.length / 2)) return;
  for (const name of stored.filter(item => !listed.has(item))) {
    await db.prepare('INSERT INTO applying_pool_retired (name, at) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET at = excluded.at').bind(name, at).run();
    await db.prepare('DELETE FROM applying_pool WHERE name = ?').bind(name).run();
  }
}

const knownPool = async db => new Map(((await db.prepare('SELECT name, start_host, signature, version, stage, stage_why FROM applying_pool').all()).results || []).map(row => [row.name, row]));
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
const dayOf = date => date.toISOString().slice(0, 10);

// A shortfall as the page sees it (the upload carries counts only; the runner's own rule is desktop/e2e/lib/record-sites.mjs shortfall, same threshold): the form was reached and fewer than half of its fields are filled.
export const shortOf = (reached, filled, left, asked = null, unexplained = null) => {
  if (reached !== 'form') return null;
  // The runner's verdict (desktop/e2e/lib/record-sites.mjs shortfall: a left field is expected when we really did not know it AND suggested an answer, or when it is a legal choice): the asked fields and how many
  // are unexplained, a miss or without a suggestion. Without it (an older run) the counts decide: under half filled.
  if (Number.isInteger(asked) && Number.isInteger(unexplained)) return unexplained > 0 ? {done: asked - unexplained, total: asked, unexplained} : null;
  return Number.isInteger(filled) && Number.isInteger(left) && filled + left > 0 && filled / (filled + left) < 0.5 ? {done: filled, total: filled + left, unexplained: null} : null;
};
const shareOf = (filled, left) => (Number.isInteger(filled) && Number.isInteger(left) && filled + left > 0 ? Math.round((100 * filled) / (filled + left)) : null);
// Needs a fix: not a posting that is gone, and a regression, a shortfall, or a stop before the form (a code or bot check is a documented hold, not a fix).
const runNeedsFix = run => { const status = rowStatus({reached: run.reached, note: run.note, regression: run.regression, asked: run.asked, unexplained: run.unexplained, short: shortOf(run.reached, run.filled, run.left_n, run.asked, run.unexplained)});
  return status.state === 'fix' ? true : status.state === 'works' || isCleanHold(status) ? false : null; };   // an eligibility stop or a site problem says nothing; every other hold is a clean run (applying-status.js)
// A documented hold (owner, 11 Oct 2026): a stop the runner made on purpose and noted (desktop/e2e/lib/record-sites.mjs parseLive): an account-first site (the smoke never creates the account)
// or an eligibility stop. A live site, never a fix and never a posting gone; any other note (a posting gone, no posting) is gone.
export {isHold};   // the list of hold notes lives in src/applying-status.js
// Each run's one status (src/applying-status.js) with the step it reached kept beside it (a dot's title says both).
const stateOf = run => ({...rowStatus({reached: run.reached, note: run.note, regression: run.regression, asked: run.asked, unexplained: run.unexplained, short: shortOf(run.reached, run.filled, run.left_n, run.asked, run.unexplained)}), step: run.reached || 'none'});
const needsFix = site => site.status.state === 'fix';

// slow(key, fn): the big readers' results kept for an hour (src/applying-store.js); the default computes them every time.
export async function data(db, now = new Date(), slow = (key, fn) => fn()) {
  const since = dayOf(new Date(now.getTime() - 30 * 86400000)), tenDays = dayOf(new Date(now.getTime() - 9 * 86400000));
  const runs = (await latestRuns(db, since)).filter(run => run.day >= since);   // each site's last runs, one row each (a scan of applying_runs read thousands of rows per load)
  const byName = kind => runs.filter(run => run.kind === kind).reduce((out, run) => ((out[run.name] ||= []).push(run), out), {});
  const sites = Object.entries(byName('smoke')).map(([name, list]) => {
    const last = list.at(-1);
    return {name, at: last.at, host: last.host, runs: list.slice(-20).map(run => ({day: run.day, at: run.at, reached: run.reached, hold: isHold(run.note), cleanHold: isCleanHold(stateOf(run)), filled: run.filled, left: run.left_n, version: run.version, needsFix: runNeedsFix(run)})), reached: last.reached, filled: last.filled, left: last.left_n, day: last.day, version: last.version, note: last.note, hold: isHold(last.note), rung: last.rung ?? null, signal: last.signal ?? null,
      regression: !!last.regression && ['fix', 'site'].includes(stateOf(last).state), short: shortOf(last.reached, last.filled, last.left_n, last.asked, last.unexplained), status: stateOf(last), states: list.slice(-10).map(stateOf), shares: list.slice(-10).map(run => shareOf(run.filled, run.left_n)), history: list.slice(-10).map(run => run.reached || 'none'), days: list.slice(-10).map(run => run.day)};
  }).sort((a, b) => Number(b.regression) - Number(a.regression) || STEPS.indexOf(a.reached) - STEPS.indexOf(b.reached));
  const replayRuns = await readReplays(db), cases = replayCases(replayRuns);   // CI on main's last runs, one row (src/applying-replays.js)
  const nights = Object.entries(runs.filter(run => run.kind === 'smoke').reduce((out, run) => {   // one bar per day, split by each run's one status (src/applying-status.js), not by the step it reached
    const counts = (out[run.day] ||= Object.fromEntries(STATES.map(state => [state, 0])));
    counts[stateOf(run).state] += 1;
    return out;
  }, {})).map(([day, counts]) => ({day, counts}));
  const pool = await poolRows(db, sites, now);
  const causes = await slow('causes', () => topCauses(db, pool.map(item => item.shape), now, Object.fromEntries(pool.filter(item => item.day).map(item => [item.shape, item.day])))).catch(() => ({}));   // the pool's own fill cards: why the form's fields stayed empty (src/applying-cause.js)
  for (const item of pool) item.cause = causes[item.shape] || null;
  const scorecard = await platformScorecard(db, pool, now, slow).catch(() => []);   // real use against the pool's tests, per platform (src/scorecard.js)
  const resolution = resolutionOf({runs, endings: await readEndings(db), pool, scorecard, now});   // the headline: how each application ends (src/applying-resolution.js)
  oneJudgment(pool, resolution);   // Needs a fix and Resolution read the same, newest judgment of a row (owner, 15 Oct 2026)
  const next = await nextToAdd(db, pool, now, slow).catch(() => ({sites: [], hidden: {hosts: 0}}));   // real users' end hosts the pool lacks (src/nextsites.js)
  const fixed = await fixedData(db, pool, cases, now).catch(() => ({day: dayOf(now), rows: [], inProgress: [], claimsAt: null, fixesAt: null, replays: []}));   // the Fixed tab, and the Back / In progress marks on the pool rows
  markStages(pool, fixed.rows);   // each row's life-cycle stage and why it may be archived (src/applying-stage.js)
  const live = sites.filter(site => ['works', 'fix', 'held'].includes(site.status.state) && site.status.rule !== 'posting closed');   // a hold is a live site; a site problem, a closed posting and a never-run row are not
  const dropped = await slow('boards', async () => (await digest(db, now)).boards).then(boards => boards.filter(board => board.dropped).map(board => ({board: board.board, earlier: board.earlierFilledShare, recent: board.recentFilledShare}))).catch(() => []);
  const fidelity = fidelityOf(await readFidelity(db).catch(() => []), pool);
  const tiles = {
      cases: cases.length, casesFailing: cases.filter(item => !item.ok).length, casesLast: cases.map(item => item.day).sort().at(-1) || null,
      sites: sites.length, sitesRecent: sites.filter(site => site.day >= tenDays).length,
      reachedForm: live.length ? Math.round((100 * live.filter(site => ['form', 'ready'].includes(site.reached)).length) / live.length) : null,
      needFix: needsFixOrder(pool, scorecard, STEPS).rows.length,   // the Needs a fix list's own count (the pool's rows, src/applying-order.js), not the smoke sites'
      regressions: sites.filter(site => site.regression && site.status.state !== 'site').length, regressionsApart: sites.filter(site => site.regression && site.status.state === 'site').length,   // a regression on a closed or refusing site is not our build's
      gone: sites.filter(site => site.status.state === 'site').length, held: sites.filter(site => site.status.state === 'held').length, dropped: dropped.length};
  return {
    tiles,
    whatWeTest: whatWeTestSection(testSets({replayRuns, pool, smokeRuns: runs.filter(run => run.kind === 'smoke'), records: fidelity.rows, now})),   // the sets the lab tests on (src/what-we-test.js)
    leftEmpty: leftEmptySection(await slow('left-empty', () => leftEmpty(db, now, 'lab')).catch(() => null) || {side: 'lab', days: 14, total: 0, groups: [], sample: null}, {wrap: 'bare'}),   // why the pool's fields were left empty (src/left-empty.js, shared with Real Form Filling); a scan of fill_cards, so behind the hour cache
    tileTones: tileTones(tiles, resolution?.raw), tileRules: TILE_RULE,
    resolution, fidelity, sites, pool, stages: stageCounts(pool), stageWords: STAGE_WORD, fixed, next, scorecard, platforms: counts(pool, 'platform', 'flow'), flows: counts(pool, 'flow', 'platform').filter(item => item.name !== '—'), cases, nights, dropped, steps: STEPS, states: STATES, stateWords: STATE_WORD, now: now.toISOString()};
}

// "Greenhouse: 4 sites, 3 flows": each group's size and how many different flows (or platforms) it holds.
const counts = (pool, key, other) => Object.entries(pool.reduce((out, item) => ((out[item[key] ?? '—'] ||= []).push(item), out), {}))
  .map(([name, list]) => ({name, sites: list.length, flows: new Set(list.map(item => item[other]).filter(Boolean)).size})).sort((a, b) => b.sites - a.sites || a.name.localeCompare(b.name));

// Every pool site (also one never run), joined with its smoke runs by name; a site that ran before it was uploaded as pool still shows, by its run host.
async function poolRows(db, sites, now) {
  const uploaded = await all(db, 'SELECT * FROM applying_pool ORDER BY name'), known = new Map(uploaded.map(row => [row.name, row]));
  const retired = new Map(((await db.prepare('SELECT name, at FROM applying_pool_retired').all().catch(() => null))?.results || []).map(row => [row.name, row.at]));   // dropped by a full upload
  const byName = Object.fromEntries(sites.map(site => [site.name, site]));
  const names = [...new Set([...uploaded.map(row => row.name), ...sites.map(site => site.name)])].filter(name => !retired.has(name) || (byName[name]?.at || '') > retired.get(name));   // a retired name returns when it runs again
  const fresh = new Date(now.getTime() - RUNNING_MINUTES * 60000).toISOString();
  const running = new Set((await all(db, 'SELECT name FROM applying_running WHERE at > ?', fresh)).map(row => row.name));
  return names.map(name => {
    const row = known.get(name) || {}, site = byName[name], start = row.start_host || site?.host || '', end = signatureHost(row.signature) || '';
    const {flow, raw} = flowOf(row.signature, start);
    const step = row.signature?.match(/#([^#]+)$/)?.[1] || null, reached = site?.reached ?? step;
    return {name: displayName(name, start), shape: name, version: site?.version ?? null, runs: site?.runs ?? [], platform: platformLabel(end, start), flow, raw, start, end, reached, day: site?.day ?? null, at: site?.at ?? null, running: running.has(name), note: site?.note ?? null, hold: !!site?.hold, status: site?.status ?? rowStatus({reached}), states: site?.states ?? (step ? [{...rowStatus({reached: step}), step}] : []), rung: site?.rung ?? null, signal: site?.signal ?? null,
      stageData: row.stage || null, stageWhy: row.stage_why || null, regression: !!site?.regression, filled: site?.filled ?? null, left: site?.left ?? null, short: site?.short ?? null, shares: site?.shares ?? [], history: site?.history ?? (step ? [step] : []), days: site?.days ?? []};
  }).sort((a, b) => Number(b.running) - Number(a.running) || a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name));
}

// The owner removes one uploaded smoke run (a run that should never have been sent): DELETE with {kind: 'smoke', day, name}. Nothing else is deleted (the replays are CI's).
export async function forget(db, body) {
  const kind = body?.kind, day = text(body?.day, 10), name = text(body?.name, 200);
  if (!kind || !day || !name) return {ok: false, error: 'kind, day and name are needed'};
  if (kind !== 'smoke') return {ok: false, error: 'kind must be smoke'};
  const done = await db.prepare('DELETE FROM applying_runs WHERE kind = ? AND day = ? AND name = ?').bind(kind, day, name).run();
  await refreshLatest(db, [{kind, name}]); await dropSnapshot(db);
  return {ok: true, removed: done?.meta?.changes ?? done?.changes ?? 0};
}

export async function view(request, env, now = new Date()) {
  if (!await viewer(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  const noStore = {'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex'};
  if (request.method === 'DELETE') {
    const result = await forget(env.STATS, await request.json().catch(() => null));
    return Response.json(result, {status: result.ok ? 200 : 400, headers: noStore});
  }
  if (request.method === 'POST') {
    const body = await request.json().catch(() => null);
    const result = await ingest(env.STATS, body, now);
    return Response.json(result, {status: result.ok ? 200 : 400, headers: noStore});
  }
  if (new URL(request.url).searchParams.has('json')) return new Response(await cachedJson(env.STATS, () => data(env.STATS, now, slowCache(env.STATS, now)), now), {headers: {'Content-Type': 'application/json', ...noStore}});
  return new Response(PAGE, {headers: {'Content-Type': 'text/html; charset=utf-8', ...noStore}});
}

export const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Lab Form Filling · Admin</title><link rel="icon" href="/favicon-32.png">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#262c33;--text:#f4efe3;--muted:#8d949c;--amber:#f5b54a;--green:#5ec47a;--red:#e5484d;--blue:#6aa8ff;--violet:#b48cff}
*{box-sizing:border-box}.tiles{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:1px;margin:14px 0;background:var(--line);border:1px solid var(--line);border-radius:12px;overflow:hidden}@media (max-width:1000px){.tiles{grid-template-columns:repeat(4,minmax(0,1fr))}}@media (max-width:520px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
.tile{background:var(--card);padding:14px 16px}.tile b{display:block;font-size:26px;line-height:1.2}.tile .what{display:block;font-size:14px;margin-top:2px}.tile span.note{display:block;margin-top:4px;color:var(--muted);font-size:12px}
.tile.warn b{color:var(--amber)}.tile.bad b{color:var(--red)}.tile.good b{color:var(--green)}section{margin:36px 0 0;padding-top:24px;border-top:1px solid var(--line)}section>h2{margin:0 0 12px}table{width:100%;border-collapse:collapse}
th{text-align:left;color:var(--muted);font-weight:500;font-size:12px;white-space:nowrap}td,th{padding:7px 8px 7px 0;border-bottom:1px solid var(--line);font-size:13px;vertical-align:top}
.st-works{background:var(--green)}.st-held{background:var(--violet)}.st-site{background:var(--muted)}.st-fix{background:var(--red)}.st-unrun{background:var(--line)}.s-none{background:var(--muted)}.s-posting{background:var(--red)}.s-account{background:var(--amber)}.s-code\\/bot{background:var(--violet)}.s-form{background:var(--blue)}.s-ready{background:var(--green)}.s-holds{background:#4cc3c9}
th.sortable{cursor:pointer;user-select:none}th.sortable:hover,th.sortable.on{color:var(--text)}.dots{white-space:nowrap}.dots i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:3px}.dots i.last{box-shadow:0 0 0 2px var(--bg),0 0 0 3.5px var(--text);margin-left:2px}
.filters{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:flex-end;margin:10px 0 12px;padding:10px 12px;background:var(--card);border:1px solid var(--line);border-radius:10px;font-size:13px}.pick{display:flex;flex-direction:column;gap:4px;min-width:200px}.pick b{line-height:34px;font-weight:600}.pick>span{font-size:11px;text-transform:uppercase;letter-spacing:.04em}.pick.search{min-width:240px}.pick input[type=search],.pick select{background:var(--bg,var(--card));color:var(--text);border:1px solid var(--line);border-radius:8px;padding:0 10px;height:34px;box-sizing:border-box;font:inherit;font-size:13px;max-width:100%}.filters .count,.filters .pager{align-self:flex-end;box-sizing:border-box;height:34px;display:flex;align-items:center}.filters .count{padding-left:4px}.filters .pager{margin:0 0 0 auto;justify-content:flex-end}.chip{background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:999px;padding:3px 11px;font:inherit;font-size:12px;cursor:pointer}.pager{display:flex;gap:8px;align-items:center;justify-content:flex-end;font-size:13px}.spin{display:inline-block;width:12px;height:12px;border:2px solid var(--line);border-top-color:var(--amber);border-radius:50%;animation:spin .8s linear infinite;vertical-align:-2px;margin-right:6px}@keyframes spin{to{transform:rotate(360deg)}}.chip:disabled{opacity:.4;cursor:default}.chip.on{border-color:var(--amber);color:var(--amber)}.chiprow{display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:34px}.chiprow .chip{height:28px;display:inline-flex;align-items:center}
table td:not(:first-child),table th:not(:first-child){white-space:nowrap}details table td:not(:first-child),details table th:not(:first-child),.legend td:last-child{white-space:normal;overflow-wrap:anywhere}.quiet{color:var(--amber);font-weight:600}.stw{font-weight:600}.stw-held{color:var(--violet)}.stw-site,.stw-unrun{color:var(--muted)}section{overflow-x:auto}.legend{margin:18px auto 0;max-width:760px}.legend h3,.legend>p{text-align:center;margin:0 0 6px}.legend table{margin:0 auto}${LADDER_CSS}
.flag{color:var(--red);font-weight:600}.inprogress{color:var(--amber);font-weight:600}section[hidden]{display:none}${FIXED_CSS}${PAGETABS_CSS}${WATCH_CSS}${RESOLUTION_CSS}${LEFT_EMPTY_CSS}${FIDELITY_CSS}${COVERAGE_CSS}.muted{color:var(--muted)}
.pooltable,.fit{table-layout:fixed}.pooltable td,.pooltable th,.fit td,.fit th{white-space:normal!important;overflow-wrap:anywhere}.pooltable tr.site{cursor:pointer}.pooltable tr.site:hover td,.pooltable tr.site.open td{background:var(--card)}.pooltable tr.site td{vertical-align:middle;padding:10px 10px 10px 0}
.sitecell{display:flex;gap:4px;align-items:flex-start}.pooltable th.c-site{width:30%}.pooltable th.c-flow{width:21%}.pooltable th.c-result{width:25%}.pooltable th.c-rung{width:10%}.pooltable th.c-runs{width:14%}.chev{display:inline-block;width:24px;color:var(--muted);transition:transform .15s;flex:none;background:none;border:0;padding:0 0 0 8px;font:inherit;font-size:18px;line-height:1.2;cursor:pointer}.open .chev{transform:rotate(90deg);color:var(--text)}.sitename b{display:block;font-size:14px}.sitename span{display:block;margin-top:2px}.stack{display:block;margin-top:2px}.stack.bad{color:var(--red);font-weight:600}.stack.hold{color:var(--violet)}
.rungbox{display:inline-block;min-width:32px;text-align:center;padding:3px 8px;border-radius:7px;background:var(--card);border:1px solid var(--line);font-weight:600}.pooltable td.c-rung,.pooltable th.c-rung{text-align:center}
tr.more td{padding:0 0 12px}.detail{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px 24px;align-items:start;margin:0;padding:12px 14px;background:var(--card);border:1px solid var(--line);border-radius:10px}.detail h4{margin:0 0 6px;font-size:12px;font-weight:500;color:var(--muted)}.detail dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;margin:0;font-size:13px}.detail dt{color:var(--muted)}.detail dd{margin:0;overflow-wrap:anywhere}.copy{margin-left:8px;background:none;border:0;color:var(--muted);cursor:pointer;font:inherit;padding:0 2px}.copy:hover{color:var(--text)}.detail .narrow{display:none}
.dots i:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
.fit th.c-case{width:26%}.fit th.c-rung{width:7%}.fit th.c-origin{width:9%}.fit th.c-result{width:26%}.fit th.c-runs{width:12%}.fit th.c-last{width:10%}.fit th.c-since{width:10%}.clamp{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
@media (max-width:640px){table td,table th{white-space:normal!important;overflow-wrap:anywhere}.fit .c-rung,.fit .c-origin{display:none}.fit th.c-case{width:24%}.fit th.c-result{width:22%}.fit th.c-runs{width:18%}.fit th.c-last,.fit th.c-since{width:18%}.fit .dots{white-space:normal}.fit .hash{font-size:11px;padding:1px 4px}}
@media (max-width:900px){.pooltable .c-flow,.pooltable .c-runs{display:none}.pooltable th.c-site{width:50%}.pooltable th.c-result{width:36%}.pooltable th.c-rung{width:14%}.detail .narrow{display:block}.detail{grid-template-columns:minmax(0,1fr)}}
${BARS_CSS}
</style></head><body><main>
<header><h1>🛡️ Lab Form Filling</h1></header>
<p class="muted">What is broken, what we fixed, and does it hold? A site that reached less than its last run is a regression. Logs and screenshots stay on the Mac.</p>
<div id="app"><p class="muted">Loading…</p></div>
<script>
const __name = target => target;   // the bundler wraps inner functions in __name(...) (esbuild keepNames); a pasted function source calls it, so the page defines it (test/needs-fix-order.test.js)
const needsFixOrder = ${ORDER_SOURCE};
const needsFixGroups = ${GROUPS_SOURCE};
const el = (tag, props = {}, ...kids) => { const node = Object.assign(document.createElement(tag), props); node.append(...kids.filter(kid => kid != null)); return node; };
const pill = step => el('span', {className: 'pill s-' + step, textContent: step});
const color = step => getComputedStyle(document.querySelector('.s-' + CSS.escape(step)) || document.body).backgroundColor;
let serverNow = Date.now();
const ago = at => { const minutes = Math.max(0, Math.round((serverNow - Date.parse(at)) / 60000)); return minutes < 1 ? 'just now' : minutes < 60 ? minutes + ' min ago' : minutes < 1440 ? Math.round(minutes / 60) + ' h ago' : Math.round(minutes / 1440) + ' d ago'; };
// A short filter as a row of chips (owner, 15 Oct 2026: "instead of this dropdown filter, chip style"): one press picks, the "all" chip clears.
// options: [[value, text], ...] with '' first for "all"; each chip keeps its value on .chipValue so a Clear button can reset the row (resetChips).
const chipFilter = (label, options, current, onPick) => { const chips = options.map(([value, text]) => el('button', {className: 'chip' + ((current || '') === value ? ' on' : ''), type: 'button', textContent: text, chipValue: value, onclick: () => { chips.forEach(chip => { chip.className = 'chip' + (chip.chipValue === value ? ' on' : ''); }); onPick(value); }}));
  return el('div', {className: 'pick chipset', role: 'group', 'aria-label': label}, el('span', {className: 'muted', textContent: label}), el('div', {className: 'chiprow'}, ...chips)); };
const resetChips = box => box.querySelectorAll('.chiprow .chip').forEach(chip => { chip.className = 'chip' + (chip.chipValue === '' ? ' on' : ''); });
const CHIP_MAX = 8;   // a filter with more options than this (platforms) stays a dropdown: a wall of chips reads worse than a list
const tile = (value, label, tone, note, title) => el('div', {className: 'tile ' + (tone || ''), title: title || ''}, el('b', {textContent: value ?? '–'}), el('span', {className: 'what', textContent: label}), note ? el('span', {className: 'note', textContent: note}) : null);
fetch('?json', {headers: {'X-Caller': 'page-tab'}}).then(r => r.json()).then(d => {
  serverNow = Date.parse(d.now);
  const app = document.getElementById('app'); app.textContent = '';
  const legend = el('div', {hidden: true}, ...d.steps.map(step => pill(step))); app.append(legend);
  const t = d.tiles, T = d.tileTones || {}, R = new Proxy(d.tileRules || {}, {get: (rules, key) => rules[key] || ''});   // an older snapshot has no tones: no colour
${RESOLUTION_SCRIPT}${FIDELITY_SCRIPT}
  // The whole picture in one row (owner, 15 Oct 2026): how applications end, what is broken, whether our fixes are real, whether we can check offline.
  // The two fix tiles take the Fixed tab's own counts (fixKind, filled once FIXED_SCRIPT has run below), so a tile and its tab never disagree.
  const fix = d.fixed?.rows || [], fids = d.fidelity?.summary || {total: 0, recorded: 0};
  const awaitingTile = tile('–', 'Awaiting verification', '', 'Fix landed, not yet two clean runs', 'Landed fixes that no run has cleared yet: the Fixed tab\\'s "Awaiting verification" rows.');
  const confirmedTile = tile('–', 'Fixes confirmed', '', 'Two clean runs after the fix', 'Landed fixes that two runs after the fix cleared: the Fixed tab\\'s "Confirmed" rows.');
  app.append(el('div', {className: 'tiles'}, resolutionTile(d.resolution),
    tile(t.reachedForm == null ? '–' : t.reachedForm + '%', 'Reached the form', T.reached, 'Of live sites', 'Share of live sites that reached the application form. ' + R.reached),
    tile(t.needFix, 'Sites needing a fix', T.needFix, 'The Needs a fix list', 'The same sites as the Needs a fix list: stopped early, unexplained fields, or a regression. ' + R.needFix),
    tile(t.regressions, 'Open regressions', T.regressions, t.regressionsApart ? 'Not ours: ' + t.regressionsApart + ' on a closed or refusing site' : 'Reached less than before', 'Sites that reached less than their last run, on a site that is still open: ours to fix. ' + (t.regressionsApart ? t.regressionsApart + ' more on a posting that is gone or a site that refused us are not counted. ' : '') + R.regressions),
    awaitingTile, confirmedTile,
    tile(fids.total ? fids.recorded + ' / ' + fids.total : '–', 'Replayable offline', '', fids.total ? (fids.total - fids.recorded) + ' with no network copy' : 'No replay data yet', 'Pool sites with a network copy that an offline replay can use (the Replay vs live table). A count, not good or bad: no colour.')));
${PAGETABS_SCRIPT}${WATCH_SCRIPT}  const resolutionBox = el('section', {className: 'resolution'}); panels.outcomes.append(resolutionBox); const fidelityBox = el('section', {className: 'fidelity'}); panels.replays.append(fidelityBox);   // the headline under the tiles, filled below once the table helpers exist (src/applying-resolution.js)
  if (t.dropped) panels.sites.append(el('p', {className: 'muted', textContent: '⚠️ ' + t.dropped + (t.dropped === 1 ? ' board' : ' boards') + ' dropped in the fleet (layer 4)', title: 'Boards dropped in the fleet (layer 4). ' + R.dropped}));   // a fleet signal, not the forms: in the Sites tab, only when one dropped (owner, 15 Oct 2026: off the tiles)
  const poolBox = el('section', {className: 'poolbox'}); panels.sites.append(poolBox);   // the pool table first, then the AI ladder (src/applying-ladder.js)
  const tabs = el('nav', {className: 'tabs', role: 'tablist', 'aria-label': 'Applying results'}), fixBox = el('section', {className: 'fix'}), fixedBox = el('section', {className: 'fixed'}), causeBox = el('section', {className: 'bycause'}), emptyBox = el('section', {className: 'leftempty'}); panels.tofix.append(tabs, fixBox, causeBox, emptyBox); panels.fixed.append(fixedBox);   // Needs a fix: right under the tiles, drawn once block() exists (drawFix)
${NIGHTS_SCRIPT}${LADDER_SCRIPT}  // A status's meaning, as its pill's hover (owner, 15 Oct 2026: the "What the colors mean" section went: the pill already says the status).
  const MEANS = {works: 'the form was reached and filled (or ready for your check)', held: 'the run stopped on purpose, by a rule it names: an account-first site, an eligibility stop, a login wall, an application by email, a page that tells how to apply, a closed posting, a code or bot check', site: 'the site refused us (retry later), a CI run the data-centre IP could not get past (it needs a Mac recording), or the posting is gone: nothing for us to fix', fix: 'a regression, a form with unexplained fields, or a stop before the form: the Rung column says where', unrun: 'never run, or nothing reported (the dash)'};
  const dots = (list, days = []) => el('span', {className: 'dots'}, ...list.map((step, at) => el('i', {title: (at === list.length - 1 ? 'Latest run · ' : '') + (days[at] ? days[at] + ' · ' : '') + (typeof step === 'number' ? (step ? 'passed' : 'failed') : step.state ? d.stateWords[step.state] + (step.rule ? ' (' + step.rule + ')' : '') + ' · ' + step.step : step), tabIndex: 0, className: (step.state ? 'st-' + step.state : '') + (at === list.length - 1 && list.length > 1 ? ' last' : ''), style: step.state ? '' : 'background:' + (typeof step === 'number' ? (step ? 'var(--green)' : 'var(--red)') : color(step))})));
  // Sortable columns (owner, 10 Oct 2026: all the red ones first): every table's header sorts ascending, then descending, then back to the page's own order. The choice is kept per
  // table across the 15 s redraw. Empty cells go last either way. For a step or a run, ascending is the worst first (red before blue); the page's own order keeps running sites on top.
  const sorts = {}, rankOf = step => (typeof step === 'number' ? step : d.steps.indexOf(step));
  const blank = value => value == null || value === '' || (typeof value === 'number' && isNaN(value));
  const sortRows = (key, rows, getters) => { const pick = sorts[key]; if (!pick || !getters[pick.col]) return rows; const dir = pick.dir === 'desc' ? -1 : 1;
    return rows.map((row, index) => ({row, index, value: getters[pick.col](row)})).sort((a, b) => (blank(a.value) - blank(b.value)) || (blank(a.value) ? 0 : a.value < b.value ? -dir : a.value > b.value ? dir : 0) || a.index - b.index).map(item => item.row); };
  const heads = (key, labels, redraw) => labels.map((label, col) => { const pick = sorts[key], on = !!pick && pick.col === col;
    const flip = () => { sorts[key] = !on ? {col, dir: 'asc'} : pick.dir === 'asc' ? {col, dir: 'desc'} : null; redraw(); };
    return el('th', {className: 'sortable' + (on ? ' on' : ''), tabIndex: 0, title: 'Sort by ' + label, textContent: label + (on ? (pick.dir === 'asc' ? ' ▲' : ' ▼') : ''), onclick: flip, onkeydown: event => { if (event.key === 'Enter') flip(); }}); });
  // The pool: every smoke site, also one never run; filters by platform and by flow combine.
  const SMALL_MISS = 2;   // a form with this many unexplained fields or fewer is a small miss: drawn quietly on Needs a fix
  const PER = 15, chosen = {platform: null, flow: null, stage: null, query: '', page: 0}, table = el('div'), bars = {};
  // A filter's select; the pool's by default, another table passes its own state, redraw and unit (the replays: 'case').
  const pick = (key, list, label, all, {state = chosen, redraw = () => draw(), unit = 'site'} = {}) => list.length <= CHIP_MAX
    ? chipFilter(label, [['', all], ...list.map(item => [item.name, (item.label || item.name) + ' · ' + item.sites])], state[key], value => { state[key] = value || null; state.page = 0; redraw(); })
    : el('label', {className: 'pick'}, el('span', {className: 'muted', textContent: label}), Object.assign(el('select', {onchange: event => { state[key] = event.target.value || null; state.page = 0; redraw(); }},
    el('option', {value: '', textContent: all}), ...list.map(item => el('option', {value: item.name, textContent: (item.label || item.name) + ' · ' + item.sites + ' ' + unit + (item.sites === 1 ? '' : 's') + (key === 'platform' ? ' · ' + item.flows + (item.flows === 1 ? ' flow' : ' flows') : '')})), ), {}));
  const count = el('span', {className: 'muted count'}), pager = el('div', {className: 'pager'}), clear = el('button', {className: 'chip', type: 'button', textContent: 'Clear', hidden: true, onclick: () => { chosen.platform = chosen.flow = chosen.stage = endingPick = null; chosen.query = ''; chosen.page = 0; filters.querySelectorAll('select').forEach(node => { node.value = ''; }); resetChips(filters); search.value = ''; draw(); }});
  // Search (owner, 11 Oct 2026): words in any order, all must match the site's name, platform, host, flow, last result, note or its "blocked at N" / regression text; it combines with the two filters.
  /*search*/ const poolText = s => [s.name, s.platform, s.start, s.end, flowText(s), s.reached ? STAGE[s.reached] || s.reached : 'not run yet', d.stateWords[s.status.state], s.status.rule, s.short ? shortText(s) : '', s.regression ? 'regression' : '', blocked(s) ? 'blocked at ' + s.rung : '', s.note, s.cause && s.cause.cause].filter(Boolean).join(' ').toLowerCase();
  const wordsIn = (text, query) => String(query || '').toLowerCase().split(/\\s+/).filter(Boolean).every(word => text.includes(word));   // every word, in any order
  const poolMatches = (s, query) => wordsIn(poolText(s), query);
  const caseMatches = (c, query) => wordsIn([c.name, c.ok ? 'passed' : 'failed', c.note, c.rung != null ? 'rung ' + c.rung : ''].filter(Boolean).join(' ').toLowerCase(), query); /*end search*/
  const search = el('input', {type: 'search', placeholder: 'Site, platform, host or result', 'aria-label': 'Search the pool', autocomplete: 'off', oninput: event => { chosen.query = event.target.value; chosen.page = 0; draw(); }});
  // Status filter: the options are the one status list (d.states, d.stateWords), each with its count; a row matches by the same status its Last result badge shows.
  /*filter*/ const stageMatch = (s, c) => (c.stage ? s.stage === c.stage : s.stage !== 'archived' || Boolean(c.query));   // archived rows stay out of the default view and come back by the Stage chip or a search (nothing is deleted)
  const inPool = (s, c) => endingMatch(s) && stageMatch(s, c) && (!c.platform || s.platform === c.platform) && (!c.flow || s.flow === c.flow) && poolMatches(s, c.query); /*end filter*/
  // Ending filter (owner, 15 Oct 2026: Resolution's "Every pool row" joined this table): the same endings as the pills in the Outcomes tab, each with its count of pool rows.
  const endingCounts = Object.fromEntries([...WORST_FIRST, NO_ENDING].map(word => [word, d.pool.filter(s => endingWordOf(s) === word).length]));
  const endingChips = d.resolution ? chipFilter('Ending', [['', 'All'], ...WORST_FIRST.map(word => [word, word.replace('_', ' ') + ' · ' + endingCounts[word]]), [NO_ENDING, 'no ending yet · ' + endingCounts[NO_ENDING]]], endingPick, value => { endingPick = value || null; chosen.page = 0; draw(); drawResolution(resolutionBox, d.resolution); }) : null;
  syncEnding = () => endingChips && endingChips.querySelectorAll('.chip').forEach(chip => { chip.className = 'chip' + (chip.chipValue === (endingPick || '') ? ' on' : ''); });
  const filters = el('div', {className: 'filters'}, el('label', {className: 'pick search'}, el('span', {className: 'muted', textContent: 'Search'}), search), pick('platform', d.platforms, 'Platform', 'All platforms · ' + d.pool.length + ' sites'), pick('flow', d.flows, 'Flow', 'All flows'), endingChips, chipFilter('Stage', [['', 'Active'], ...(d.stages || []).map(item => [item.name, item.label + ' · ' + item.sites])], chosen.stage, value => { chosen.stage = value || null; chosen.page = 0; draw(); }), count, clear, pager);
  // The rung that made the last decision; a site that ran and did not reach the form is "blocked at N" (red) with the signal when known, "?" when the rung is unknown.
  const blocked = s => s.status.state === 'fix' && !['form', 'ready'].includes(s.reached) && s.rung != null;   // only a row that needs a fix is blocked (a hold or a site problem is not)
  const stateWord = s => el('span', {className: 'stw stw-' + s.status.state, textContent: s.status.state === 'held' ? 'Held' : s.status.next ? 'Blocked in CI' : d.stateWords[s.status.state]});   // a held or site-problem row shows its status where the rung would say Blocked
  const shortText = s => (s.short.unexplained != null ? s.short.unexplained + ' unexplained of ' + s.short.total : s.short.done + ' of ' + s.short.total + ' filled');   // the verdict, or the old count
  // Sorting by a row's run dots (owner, 12 Oct 2026): each failed run -1, each good run +1, a newer run weighs a hair more (a tie breaker only); the first click puts the most failures first.
  // One score for every dots column (the pool's Recent runs, the replays' Last 10 runs). A pool run is good from the form on, failed before it; a code or bot check is a documented hold: neither.
  /*runs score*/ const runsScore = (list, good) => (list.length ? list.reduce((sum, run, at) => sum + (good(run) === true ? 1 : good(run) === false ? -1 : 0) * (1 + (at + 1) / 1000), 0) : null);
  const poolRunGood = run => (run.state === 'works' ? true : run.state === 'fix' ? false : null); /*end runs score*/
  const POOL_GET = [s => s.name.toLowerCase(), s => s.flow, s => (s.reached ? rankOf(s.reached) - (s.short ? 0.5 : 0) : null), s => (s.rung == null ? null : s.rung + (blocked(s) ? 10 : 0)), s => runsScore(s.states, poolRunGood)];
  // The pool table (owner mockup, 10 Oct 2026: five columns that fit the page, the route and the exact time in an expandable row). The site name carries its host in brackets: it moves under the name, next to the platform.
  const toggleOpen = (set, key) => { const was = set.has(key); set.clear(); if (!was) set.add(key); };   // one row open at a time in every expandable table; the key is unique (a pool row's shape, never its display name)
  const open = new Set(), STAGE = {none: 'Nothing reached', posting: 'Posting reached', account: 'Account reached', 'code/bot': 'Code or bot check', form: 'Form reached', ready: 'Ready for your check'};
  // Two rows with one display name and one start host (a custom row beside its platform row) are told apart by the shape name, in every list that shows a row.
  const twins = d.pool.reduce((out, s) => ((out[s.name + '|' + s.start] = (out[s.name + '|' + s.start] || 0) + 1), out), {}), twinTag = s => (twins[s.name + '|' + s.start] > 1 ? ' · ' + s.shape : '');
// A row made from a report a person sent ("reported-<id>-<site>": tools/reports-fetch.mjs names it so).
const reportedTag = s => (/^reported-/.test(s.shape || s.name || '') ? el('span', {className: 'stack inprogress', textContent: 'Reported by a person'}) : null);
  const split = s => { const host = (s.name.match(/\\(([^()\\s]+\\.[a-z]{2,})\\)/) || [])[1] || s.start; return {title: s.name.replace(/\\s*\\([^()\\s]+\\.[a-z]{2,}\\)/, ''), sub: s.platform + (host ? ' (' + host + ')' : '') + twinTag(s) + (s.stage && s.stage !== 'new' ? ' · ' + (d.stageWords || {})[s.stage] : '')}; };
  const flowText = s => (s.flow ? s.flow.replace(' and form on one page', ' + form').replace('no-form', 'no form').replace(/^./, c => c.toUpperCase()) : '—');
  const resultOf = s => [el('span', {className: 'pill st-' + s.status.state, title: (s.status.rule && s.status.from !== 'ending' ? s.status.rule + ': ' : '') + (MEANS[s.status.state] || ''), textContent: s.status.next ? s.status.rule.replace(/^./, c => c.toUpperCase()) : d.stateWords[s.status.state] + (s.status.rule && s.status.state !== 'fix' && s.status.from !== 'ending' ? ' · ' + s.status.rule : '')}),   // a rule that only names the row's ending is not repeated: the small ending pill under the status says it
    s.status.next ? el('span', {className: 'stack muted', textContent: 'Next: ' + s.status.next}) : null,
    s.reached ? el('span', {className: 'stack muted', textContent: STAGE[s.reached] || s.reached}) : null,
    s.short ? el('span', {className: 'stack bad', title: 'reached the form, with fields left that we should have known or suggested', textContent: shortText(s)}) : null,
    s.regression ? el('span', {className: 'stack bad', textContent: 'regression'}) : null, s.note && !s.status.next ? el('span', {className: s.status.state === 'held' ? 'stack hold' : 'stack muted', title: s.status.state === 'held' ? 'Held on purpose: the run stopped here by a rule, not a fix' : '', textContent: s.note}) : null].filter(Boolean);
  const copy = text => el('button', {className: 'copy', type: 'button', title: 'Copy', 'aria-label': 'Copy ' + text, textContent: '⧉', onclick: event => { event.stopPropagation(); try { navigator.clipboard.writeText(text); } catch (error) { /* a copy is only a convenience */ } }});
  const route = s => el('div', {}, el('h4', {textContent: 'Route'}), el('dl', {}, el('dt', {textContent: 'Start'}), el('dd', {}, s.start || '…', s.start ? copy(s.start) : null), ...(s.end && s.end !== s.start ? [el('dt', {textContent: 'End'}), el('dd', {}, s.end, copy(s.end))] : [])));
  const lastRun = s => el('div', {}, el('h4', {textContent: s.at ? 'Last completed run · ' + new Date(s.at).toUTCString().slice(5, 22) + ' UTC' : 'Last completed run'}),
    el('div', {}, ...resultOf(s)), s.signal ? el('div', {className: 'muted', textContent: 'rung ' + s.rung + ' handed on: ' + s.signal}) : null,
    s.cause ? el('div', {className: 'muted', textContent: 'Top cause: ' + s.cause.cause + ' · ' + s.cause.lost + ' on ' + s.cause.nights + ' day' + (s.cause.nights === 1 ? '' : 's')}) : null);
  const siteRows = s => { const on = open.has(s.shape), flip = () => { toggleOpen(open, s.shape); draw(); }, parts = split(s), runs = () => (s.states.length ? dots(s.states, s.days) : el('span', {className: 'muted', textContent: '—'}));
    const main = el('tr', {className: 'site' + (on ? ' open' : ''), onclick: flip},
      el('td', {className: 'c-site'}, el('div', {className: 'sitecell'}, el('button', {className: 'chev', type: 'button', 'aria-expanded': String(on), 'aria-label': (on ? 'Collapse ' : 'Expand ') + parts.title, textContent: '›', onclick: event => { event.stopPropagation(); flip(); }}), el('div', {className: 'sitename'}, el('b', {textContent: parts.title}), el('span', {className: 'muted', textContent: parts.sub}), reportedTag(s)))),
      el('td', {className: 'c-flow', title: s.raw || '', textContent: flowText(s)}),
      el('td', {className: 'c-result'}, ...resultOf(s), endingLine(s), s.running ? el('span', {className: 'stack muted'}, el('i', {className: 'spin'}), 'Running now') : el('span', {className: 'stack muted', title: s.at || '', textContent: s.at ? ago(s.at) : ''}), watchButton(s.name, () => { if (!open.has(s.shape)) toggleOpen(open, s.shape); draw(); })),
      el('td', {className: 'c-rung'}, blocked(s) ? el('span', {className: 'flag', title: s.signal || ''}, 'Blocked', el('span', {className: 'stack', textContent: 'at ' + s.rung})) : ['held', 'site'].includes(s.status.state) ? stateWord(s) : s.rung == null ? el('span', {className: 'muted', title: 'not reported', textContent: s.reached ? '?' : '—'}) : el('span', {className: 'rungbox', textContent: s.rung})),
      el('td', {className: 'c-runs'}, runs()));
    return on ? [main, el('tr', {className: 'more'}, el('td', {colSpan: 5}, el('div', {className: 'detail'}, route(s), lastRun(s), el('div', {className: 'narrow'}, el('h4', {textContent: 'Flow'}), el('div', {textContent: flowText(s)})), el('div', {className: 'narrow'}, el('h4', {textContent: 'Recent runs · old → new'}), runs()), watchPlayer(s.name))))] : [main]; };
  const draw = () => { const rows = sortRows('pool', d.pool.filter(s => inPool(s, chosen)), POOL_GET), pages = Math.max(1, Math.ceil(rows.length / PER)); chosen.page = Math.min(chosen.page, pages - 1); const shown = rows.slice(chosen.page * PER, (chosen.page + 1) * PER); table.textContent = ''; count.textContent = 'Showing ' + (rows.length ? chosen.page * PER + 1 : 0) + '–' + (chosen.page * PER + shown.length) + ' of ' + rows.length + (rows.length < d.pool.length ? ' (' + d.pool.length + ' in the pool)' : ''); pager.textContent = ''; clear.hidden = !chosen.platform && !chosen.flow && !endingPick && !chosen.stage && !chosen.query;
    table.append(rows.length ? el('table', {className: 'pooltable'}, el('tr', {}, ...heads('pool', ['Site / platform', 'Flow', 'Last result', 'Rung', 'Recent runs · old → new'], () => { chosen.page = 0; draw(); }).map((th, at) => Object.assign(th, {className: th.className + ' ' + ['c-site', 'c-flow', 'c-result', 'c-rung', 'c-runs'][at]}))),
      ...shown.flatMap(siteRows)) : el('p', {className: 'muted', textContent: 'No site matches.'}), rows.length ? el('p', {className: 'muted', style: 'text-align:center;font-size:12px', textContent: 'Expand a row for the route and the last run.'}) : null);
    if (pages > 1) { const go = step => () => { chosen.page += step; draw(); };
      pager.append(el('button', {className: 'chip', type: 'button', textContent: '← Previous', disabled: chosen.page === 0, onclick: go(-1)}),
        el('button', {className: 'chip', type: 'button', textContent: 'Next →', disabled: chosen.page >= pages - 1, onclick: go(1)})); } };
  // Next sites to add: first the platforms most matched jobs are on that the pool covers too little (from any number of installs), then the hosts real applications ended on
  // that the pool lacks, each used by >= 3 installs (src/nextsites.js). Top 10 of each, the rest on request.
  // Each list is a bar (its title, "Showing 1-10 of N", Previous / Next) over a table: the pool table's own pattern, 10 rows a page (NEXT_PER, shared by the Fixed table).
  const nextPage = {platforms: 0, sites: 0, score: 0, fix: 0, fixed: 0, causes: 0}, NEXT_PER = 10, nextBox = el('div'), scoreBox = el('div');
  const block = (key, title, what, allRows, labels, row, none, redraw = () => drawNext(), getters = []) => {
    const rows = sortRows(key, allRows, getters), pages = Math.max(1, Math.ceil(rows.length / NEXT_PER)); nextPage[key] = Math.min(nextPage[key], pages - 1);
    const from = nextPage[key] * NEXT_PER, shown = rows.slice(from, from + NEXT_PER), go = step => () => { nextPage[key] += step; redraw(); };
    return [el('div', {className: 'filters'}, el('label', {className: 'pick'}, el('span', {className: 'muted', textContent: title}), el('b', {textContent: what})),
        el('span', {className: 'muted count', textContent: rows.length ? 'Showing ' + (from + 1) + '–' + (from + shown.length) + ' of ' + rows.length : none}),
      pages > 1 ? el('div', {className: 'pager'}, el('button', {className: 'chip', type: 'button', textContent: '← Previous', disabled: nextPage[key] === 0, onclick: go(-1)}),
        el('button', {className: 'chip', type: 'button', textContent: 'Next →', disabled: nextPage[key] >= pages - 1, onclick: go(1)})) : null),
      rows.length ? el('table', {className: key === 'fix' || key === 'causes' ? 'fixtable' : ''}, el('tr', {}, ...heads(key, labels, () => { nextPage[key] = 0; redraw(); })), ...shown.flatMap(row)) : null];
  };
${COVERAGE_SCRIPT}  // Needs a fix and its worst-first order live in src/applying-order.js, one function shared with tools/needs-fix-order.mjs (the source is embedded at the top of this script).
  let ORDER = needsFixOrder(d.pool, d.scorecard, d.steps);   // recomputed on every draw: the page refreshes its data
  const useOf = s => ORDER.useOf(s);
  const filledRuns = s => (s.shares || []).filter(value => value != null);
  // The Needs a fix row (owner, 11 Oct 2026: seven columns overflowed the panel): the site with its platform, why, when; platform use, top cause and the filled runs open in the row.
  const needOpen = new Set();
  const needDetail = s => el('div', {className: 'detail'},
    el('div', {}, fixShort(s.name) !== s.name ? el('div', {}, el('h4', {textContent: 'Scenario'}), el('div', {textContent: s.name})) : null,
      el('h4', {textContent: 'Platform use'}), el('div', {textContent: useOf(s) ? useOf(s) + '% of the matched jobs' : '—'}),
      el('h4', {textContent: 'Top cause'}), el('div', {textContent: s.cause ? s.cause.cause + ' · ' + s.cause.lost + ' on ' + s.cause.nights + ' day' + (s.cause.nights === 1 ? '' : 's') : '—'})),
    el('div', {}, el('h4', {textContent: 'Filled, last runs'}), el('div', {textContent: filledRuns(s).length ? filledRuns(s).join(' → ') + '%' : '—'}),
      el('h4', {textContent: s.at ? 'Last run · ' + new Date(s.at).toUTCString().slice(5, 22) + ' UTC' : 'Last run'}), el('div', {textContent: s.at ? ago(s.at) : '—'})));
    const needRow = s => { const on = needOpen.has(s.shape), flip = () => { toggleOpen(needOpen, s.shape); drawFix(); };
    const main = el('tr', {className: 'site' + (on ? ' open' : ''), onclick: flip},
      el('td', {}, el('div', {className: 'sitename'}, el('b', {textContent: fixShort(s.name)}), el('span', {className: 'muted', textContent: s.platform + (s.start ? ' (' + s.start + ')' : '') + twinTag(s)}), reportedTag(s))),
      el('td', {}, el('span', {className: s.short && !s.regression && s.short.unexplained != null && s.short.unexplained <= SMALL_MISS ? 'quiet' : 'flag', textContent: s.regression ? 'regression' : s.short ? 'form · ' + shortText(s) : 'stopped at the ' + s.reached}),
        s.didntHold ? el('span', {className: 'stack flag', textContent: 'Fix didn’t hold (' + s.didntHold + ')'}) : s.back ? el('span', {className: 'stack flag', textContent: 'Back · fixed before, listed again'}) : null, s.claimed ? el('span', {className: 'stack inprogress', textContent: 'In progress · since ' + ago(s.claimed)}) : null,
        s.regression ? el('span', {className: 'stack muted', textContent: offlineLine(s)}) : null),   // the offline replay's verdict: Our build / Site changed / Needs a recording (src/applying-verify.js)
      el('td', {className: 'muted', textContent: s.at ? ago(s.at) : '—'}),
      el('td', {}, watchButton(s.name, () => { if (!needOpen.has(s.shape)) toggleOpen(needOpen, s.shape); drawFix(); }), el('button', {className: 'chev', type: 'button', 'aria-expanded': String(on), 'aria-label': (on ? 'Collapse ' : 'Expand ') + s.name, textContent: '›', onclick: event => { event.stopPropagation(); flip(); }})));
    return on ? [main, el('tr', {className: 'more'}, el('td', {colSpan: 4}, needDetail(s), watchPlayer(s.name)))] : [main]; };
  const drawFix = () => { fixBox.textContent = ''; ORDER = needsFixOrder(d.pool, d.scorecard, d.steps);
    fixBox.append(el('div', {className: 'fixpanel'}, el('div', {className: 'fixhead'}, el('h2', {textContent: 'Needs a fix · where applying stops'}),
      el('p', {className: 'muted', textContent: 'A regression, a stop before the form, or a form reached with fields left that we should have known or suggested an answer for. Open a row for the platform use, the top cause and the share of fields filled in each of the last runs: a fix shows there after the site\\'s next run.'})),
      ...block('fix', 'Sites', 'Worst first: regressions, then the platform most used', ORDER.rows, ['Site / platform', 'Why', 'Last run', 'Details'], needRow,
        'Nothing needs a fix', () => drawFix(), [s => s.name.toLowerCase(), s => ORDER.rank.get(s.shape), s => (s.at ? Date.parse(s.at) : null)]).filter(Boolean))); };
  // By cause (owner, 11 Oct 2026): the Needs a fix rows grouped by their top cause, biggest first, after "Run first" (rows that need a pool run, not a fix); src/applying-groups.js, shared with
  // tools/needs-fix-causes.mjs. A row opens to its sites. The session that holds a claim never reaches the site, so the column counts claimed rows.
  const causeOpen = new Set();
  const causeDetail = g => el('div', {className: 'detail'}, el('div', {}, el('h4', {textContent: g.hint || 'Sites'}),
    el('ul', {className: 'fixguard'}, ...g.rows.map(s => el('li', {}, s.name, el('span', {className: 'muted', textContent: ' · ' + s.platform + (s.at ? ' · last run ' + ago(s.at) : ' · never run') + (s.version ? ' · build ' + s.version : '') + (g.reasons[g.rows.indexOf(s)] && g.reasons[g.rows.indexOf(s)] !== 'never run' ? ' · ' + g.reasons[g.rows.indexOf(s)] : '') + (s.claimed ? ' · claimed' : '')}))))));
  const causeRow = g => { const on = causeOpen.has(g.key), flip = () => { toggleOpen(causeOpen, g.key); drawCauses(); };
    const main = el('tr', {className: 'site' + (on ? ' open' : ''), onclick: flip},
      el('td', {}, el('div', {className: 'sitename'}, el('b', {textContent: g.label}), g.hint ? el('span', {className: 'muted', textContent: g.hint}) : null)),
      el('td', {textContent: String(g.count)}), el('td', {className: 'muted', textContent: g.claimed ? g.claimed + ' of ' + g.count : '—'}),
      el('td', {className: 'muted', textContent: g.neverRun ? 'never run' + (g.neverRun < g.count && g.oldest ? ' (+ ' + ago(g.oldest) + ')' : '') : g.oldest ? ago(g.oldest) : '—'}),
      el('td', {}, el('button', {className: 'chev', type: 'button', 'aria-expanded': String(on), 'aria-label': (on ? 'Collapse ' : 'Expand ') + g.label, textContent: '›', onclick: event => { event.stopPropagation(); flip(); }})));
    return on ? [main, el('tr', {className: 'more'}, el('td', {colSpan: 5}, causeDetail(g)))] : [main]; };
  const causeGroups = () => needsFixGroups(d.pool, d.scorecard, d.steps, d.fixed.rows);
  const drawCauses = () => { causeBox.textContent = '';
    causeBox.append(el('div', {className: 'fixpanel'}, el('div', {className: 'fixhead'}, el('h2', {textContent: 'By cause · what to fix first'}),
      el('p', {className: 'muted', textContent: 'The rows that need a fix, grouped by their top cause, the biggest first. The rows listed first need a pool run, not a fix: they never ran, or their last run is older than a fix that landed for them. Every row is in exactly one group.'})),
      ...block('causes', 'Groups', 'Run first, then the biggest cause', causeGroups(), ['Cause', 'Rows', 'Claimed', 'Oldest run', 'Details'], causeRow, 'Nothing needs a fix', () => drawCauses(), [g => g.label.toLowerCase(), g => g.count, g => g.claimed, g => (g.oldest ? Date.parse(g.oldest) : null)]).filter(Boolean))); };
${FIXED_SCRIPT}
  { const kinds = fix.map(fixKind), awaiting = kinds.filter(kind => kind === 'landed').length, confirmed = kinds.filter(kind => kind === 'confirmed').length;
    awaitingTile.children[0].textContent = awaiting; awaitingTile.className = 'tile' + (awaiting ? ' warn' : '');   // children[0] is the tile's number (tile() above)
    const holds = fix.filter(row => row.offline && row.offline.verdict === 'holds').length;   // "Holds offline" is named in the note, never added to the number (owner, 15 Oct 2026)
    confirmedTile.children[0].textContent = confirmed; confirmedTile.children[2].textContent = 'Two clean runs after the fix' + (holds ? ' · + ' + holds + ' hold offline' : ''); confirmedTile.className = 'tile' + (confirmed ? ' good' : awaiting ? ' bad' : ''); }
  drawFix(); drawFixed(); drawCauses(); showTab(); drawResolution(resolutionBox, d.resolution); drawFidelity(fidelityBox, d.fidelity);
${CASES_SCRIPT}  poolBox.append(el('h2', {textContent: 'The pool · every smoke site'}), ...(d.pool.length ? [filters, table]
    : [el('p', {className: 'muted', textContent: 'No pool uploaded yet: cd desktop/e2e && npm run record-sites'})])); if (d.pool.length) draw(); poolRedraw = () => { chosen.page = 0; draw(); };
  if (d.leftEmpty) emptyBox.innerHTML = d.leftEmpty;   // the shared section, rendered by the server (src/left-empty.js), the third To fix sub-tab
  // Fetch again every 5 minutes while the tab is visible (and once when it becomes visible after longer), so the spinner and the times follow a run without a reload.
  // The server keeps the data for up to 10 minutes (src/applying-store.js), so a faster refresh would only repeat the same answer.
  let fetchedAt = Date.now();
  const refresh = () => { if (document.hidden) return; fetchedAt = Date.now(); fetch('?json', {headers: {'X-Caller': 'page-tab'}}).then(r => r.json()).then(fresh => { serverNow = Date.parse(fresh.now); d.pool = fresh.pool; d.next = fresh.next; d.scorecard = fresh.scorecard; d.fixed = fresh.fixed; d.cases = fresh.cases; draw(); if (d.cases.length) drawCases(); drawFix(); drawFixed(); drawCauses(); showTab(); showPage(); drawNext(); drawScore(); }).catch(() => {}); };
  loadVideos(() => { if (d.pool.length) draw(); drawFix(); drawFixed(); });   // the ▶ Watch buttons appear when the index answers
  setInterval(refresh, 300000);
  document.addEventListener?.('visibilitychange', () => { if (!document.hidden && Date.now() - fetchedAt > 300000) refresh(); });
}).catch(error => { document.getElementById('app').textContent = 'Could not load: ' + error.message; });
</script></main></body></html>`;
