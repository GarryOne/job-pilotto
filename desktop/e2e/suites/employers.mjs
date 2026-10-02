/* global window */
// Find new employers + the Employers & Sources data. A candidate list with every kind of company (two good boards, an empty one, one with only wrong roles, a dead
// feed, a duplicate of a source already in use, an excluded company, a manual-watch company) is run from the Actions page; then what the scout decided, what it wrote
// into Notion and into its run row, what a second run does, what the crawl would now read, and a Sonnet judge on whether the added employers suit the person.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {E2E} from '../lib/app.mjs';
import {duplicates, EXPECTED, parseRunLine, rowProblems} from '../lib/employers.mjs';
import {judge, problems as judgeProblems} from '../lib/judge.mjs';
import {finish, visit} from '../lib/layout.mjs';
import {emptyDatabase, readRows} from '../lib/notion.mjs';
import {ensureSetUp} from '../lib/seed.mjs';

export const minutes = 15;
export const name = 'employers';
// The scout judges feeds for this person whatever the test workspace's search settings hold (src/paths.py: JOB_PILOTTO_LOCATIONS_FILE).
export const env = {JOB_PILOTTO_LOCATIONS_FILE: path.join(E2E, 'fixtures', 'feeds', 'employers', 'person.json')};
const PERSON = 'A fictional senior site reliability / platform engineer in Zurich, Switzerland (Kubernetes, AWS, Terraform), looking for SRE, platform and DevOps roles in Zurich or elsewhere in Switzerland.';
const ROOT = path.resolve(E2E, '..', '..');

const find = dir => {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { const hit = find(full); if (hit) return hit; } else if (entry.name === 'jobs.sqlite') return full;
  }
  return null;
};

// What the scout decided (its candidate table), the feeds it registered, and the list the jobs crawl would read (the engine's own active_sources: starter list + registered feeds).
function engineState(ctx) {
  const db = find(ctx.profile);
  if (!db) throw new Error('the app has no jobs.sqlite in its data folder');
  const script = `import json, sqlite3, sys
from src import scout, store
path, starter = sys.argv[1], json.load(open(sys.argv[2]))
c = sqlite3.connect(path); c.row_factory = sqlite3.Row
rows = lambda q: [dict(r) for r in c.execute(q)]
with store.connect(__import__('pathlib').Path(path)) as db:
    crawl = [s['company'] for s in scout.active_sources(db, None, starter)]
print(json.dumps({'candidates': rows('select name, status, ats, slug, quality from scout_candidates'), 'registered': rows('select ats, slug, company, quality, active from feed_sources'), 'crawl': crawl}))`;
  const out = execFileSync('python3', ['-c', script, db, path.join(ctx.profile, 'config', 'sources.json')],
    {cwd: ROOT, env: {...process.env, ...env, JOB_PILOTTO_FIXTURE_DIR: ctx.feeds}});
  return JSON.parse(out.toString());
}

const scoutStarts = ctx => fs.readFileSync(path.join(ctx.profile, 'logs', 'app.log'), 'utf8').split('\n').filter(line => /\[run\] start: python -m src scout /.test(line)).length;

// Click "Find new employers" on the Actions page and wait until the app shows no task running. -> the scout runs the app lists for it (newest first).
async function findEmployers(ctx) {
  const {page} = ctx;
  const scouts = () => page.evaluate(async () => {
    const data = await window.pilot.runs();
    return {running: !!data.running || (data.queued || []).length > 0,
      runs: (data.runs || []).filter(item => item.kind === 'scout').map(item => ({ok: item.ok, trigger: item.trigger, result: item.result || item.summary || ''}))};
  });
  // A fresh install starts its own catch-up checks (Gmail) a few seconds after launch: begin when the app has been quiet for a while, so only this click is counted.
  for (let quietSince = Date.now(); Date.now() - quietSince < 25000;) {
    if ((await scouts()).running) quietSince = Date.now();
    await page.waitForTimeout(2000);
  }
  const before = (await scouts()).runs.length, startsBefore = scoutStarts(ctx);
  await page.click('.nav[data-view="actions"]');
  await page.click('[data-command="scout"]');
  const started = Date.now();
  let now;
  for (;;) {
    now = await scouts();
    if (!now.running && now.runs.length > before) break;
    if (Date.now() - started > 240000) throw new Error('Find new employers did not finish within 4 minutes');
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(6000);   // a second run that was only waiting its turn would start now
  now = await scouts();
  while (now.running && Date.now() - started < 240000) { await page.waitForTimeout(2000); now = await scouts(); }
  const engineRuns = scoutStarts(ctx) - startsBefore;
  if (engineRuns !== 1) throw new Error(`one click started ${engineRuns} Find new employers runs (the app's own log shows ${engineRuns} engine starts)`);
  return now.runs.slice(0, now.runs.length - before);
}

// The scout's rows in Notion's run list, oldest first, as numbers.
async function notionRuns(token) {
  const rows = (await readRows(token, 'Cronjob Runs')).filter(row => row.Mode === 'scout');
  return rows.sort((a, b) => String(a.Started).localeCompare(String(b.Started))).map(row => ({row, line: parseRunLine(row.Summary)}));
}

export async function run(ctx) {
  const {page, token: NOTION} = ctx;
  ctx.findings = [];
  await ensureSetUp(ctx);
  const state = {};

  await ctx.run('this suite starts with no employers and no runs in its Notion page, and a candidate list of every kind', async () => {
    const cleared = [await emptyDatabase(NOTION, 'Employers & Sources'), await emptyDatabase(NOTION, 'Cronjob Runs')];
    console.log(`  cleared ${cleared[0]} employer row(s) and ${cleared[1]} run row(s)`);
    // Nimbus' postings are three days old whenever the suite runs (freshness is part of the quality score); Orbit's stay old on purpose.
    const nimbusFile = path.join(ctx.feeds, 'employers', 'nimbus.json');
    const nimbus = JSON.parse(fs.readFileSync(nimbusFile, 'utf8'));
    for (const job of nimbus.jobs) job.updated_at = new Date(Date.now() - 3 * 86400000).toISOString();
    fs.writeFileSync(nimbusFile, JSON.stringify(nimbus));
    fs.mkdirSync(path.join(ctx.profile, 'config'), {recursive: true});
    fs.copyFileSync(path.join(ctx.E2E, 'fixtures', 'feeds', 'sources.json'), path.join(ctx.profile, 'config', 'sources.json'));   // E2E Acme and E2E Beta are already sources
    fs.copyFileSync(path.join(ctx.E2E, 'fixtures', 'feeds', 'employers', 'scout_seeds.json'), path.join(ctx.profile, 'config', 'scout_seeds.json'));
  }, {needs: ctx.needs});

  await ctx.run('one click on Find new employers is one run, and it ends', async () => {
    state.runs = await findEmployers(ctx);
    console.log(`  runs started by one click: ${JSON.stringify(state.runs)}`);
    const failed = state.runs.filter(item => item.ok === false);
    if (failed.length) throw new Error(`the run failed: ${failed[0].result}`);
    if (state.runs.length !== 1) throw new Error(`the app lists ${state.runs.length} Find new employers runs for one click: ${JSON.stringify(state.runs)}`);
    state.first = engineState(ctx);
  }, {needs: ctx.needs});

  await ctx.run('each candidate ends in the right status, and only genuinely useful boards become sources', async () => {
    const {candidates, registered} = state.first;
    const status = Object.fromEntries(candidates.map(item => [item.name, item]));
    const problems = [];
    for (const [company, want] of Object.entries(EXPECTED)) {
      const got = status[company];
      if (want.status === 'excluded') { if (got) problems.push(`${company} is excluded but the scout kept it as a candidate (${got.status})`); continue; }
      if (!got) { problems.push(`${company} was never a candidate`); continue; }
      // The scout stores a duplicate as 'found' (it is a feed already in use), and tells it apart by not registering it again.
      const shown = want.status === 'duplicate' ? 'found' : want.status;
      if (got.status !== shown) problems.push(`${company}: status ${got.status}, expected ${want.status}`);
    }
    const sources = registered.map(item => item.company).sort();
    const wanted = Object.entries(EXPECTED).filter(([, want]) => want.status === 'found').map(([company]) => company).sort();
    if (JSON.stringify(sources) !== JSON.stringify(wanted)) problems.push(`registered sources are [${sources}], expected [${wanted}]${sources.includes('E2E Acme Labs') ? ' (E2E Acme Labs is the same board as the starter source E2E Acme)' : ''}`);
    if (problems.length) throw new Error(problems.join('; '));
    const [nimbus, orbit] = ['E2E Nimbus', 'E2E Orbit'].map(company => status[company].quality);
    console.log(`  quality: Nimbus ${nimbus}, Orbit ${orbit}`);
    if (!(nimbus > orbit)) throw new Error(`the board with 4 fresh roles in Zurich (${nimbus}) must outscore the one with 1 old role there (${orbit})`);
    if (nimbus - orbit < 20) throw new Error(`quality barely tells a strong board (${nimbus}) from a weak one (${orbit})`);
  }, {needs: ctx.needs});

  await ctx.run('Employers & Sources in Notion holds a complete, sensible row per candidate, and none for the duplicate or the excluded', async () => {
    state.rows = await readRows(NOTION, 'Employers & Sources');
    const byName = Object.fromEntries(state.rows.map(row => [row.Company, row]));
    const problems = [];
    for (const [company, want] of Object.entries(EXPECTED)) {
      const row = byName[company];
      if (want.feed == null) { if (row) problems.push(`${company} must not have a row (${want.status}), it has one: ${row['Feed status']}`); continue; }
      if (!row) { problems.push(`${company} has no row in Employers & Sources`); continue; }
      problems.push(...rowProblems(row, want.status));
      if (row['Feed status'] !== want.feed) problems.push(`${company}: Feed status "${row['Feed status']}", expected "${want.feed}"`);
      if (row.Active !== want.active) problems.push(`${company}: Active is ${row.Active}, expected ${want.active}`);
    }
    // The numbers in a row come from the fixture boards: Nimbus has 5 postings, 4 of them SRE-type, all 4 in Zurich; Orbit 3, 2 and 1.
    const nimbus = byName['E2E Nimbus'], orbit = byName['E2E Orbit'];
    if (nimbus && !(nimbus.ATS === 'greenhouse' && nimbus.Slug === 'e2e-nimbus' && nimbus['Relevant roles'] === 4 && nimbus['In preferred places'] === 4 && /zurich/i.test(nimbus.Cities) && /5 postings; 4 SRE-type; 4 in preferred places/.test(nimbus.Notes))) problems.push(`E2E Nimbus' row does not match its board: ${JSON.stringify({ats: nimbus.ATS, slug: nimbus.Slug, relevant: nimbus['Relevant roles'], preferred: nimbus['In preferred places'], cities: nimbus.Cities, notes: nimbus.Notes})}`);
    if (orbit && !(orbit['Relevant roles'] === 2 && orbit['In preferred places'] === 1 && /zurich/i.test(orbit.Cities) && !/lisbon/i.test(orbit.Cities))) problems.push(`E2E Orbit's row does not match its board (2 relevant, 1 in Zurich, none in Lisbon): ${JSON.stringify({relevant: orbit['Relevant roles'], preferred: orbit['In preferred places'], cities: orbit.Cities})}`);
    if (nimbus && orbit && !(nimbus.Quality > orbit.Quality)) problems.push(`Notion's quality does not order the boards: Nimbus ${nimbus.Quality}, Orbit ${orbit.Quality}`);
    if (byName['E2E Quiet'] && !/quiet\.e2e\.test/.test(byName['E2E Quiet'].Careers || '')) problems.push(`E2E Quiet's Careers link is "${byName['E2E Quiet'].Careers}"`);
    if (problems.length) throw new Error(problems.join('; '));
  }, {needs: ctx.needs});

  await ctx.run("the run's row says what happened, and the numbers are the real ones", async () => {
    const runs = await notionRuns(NOTION);
    console.log(`  run rows: ${runs.map(item => item.row.Summary).join(' | ')}`);
    if (!runs.length) throw new Error('Find new employers left no row in the Notion run list');
    const {line, row} = runs[0];
    if (!line) throw new Error(`the run row says "${row.Summary}": no "checked N" and no "N new sources"`);
    const registered = state.first.registered.length;
    if (line.checked !== state.first.candidates.length) throw new Error(`the row says checked ${line.checked}, the scout checked ${state.first.candidates.length}`);
    if (line.added !== registered) throw new Error(`the row says ${line.added} new sources, the scout registered ${registered}`);
    const shown = state.runs[0].result;
    const app = parseRunLine(shown);
    if (!app || app.checked !== line.checked || app.added !== line.added) throw new Error(`the app's Recent runs says "${shown}", Notion says "${row.Summary}"`);
  }, {needs: ctx.needs});

  await ctx.run("the crawl's source list now holds the starter employers and the two new boards, and nothing else", async () => {
    const crawl = [...state.first.crawl].sort();
    const wanted = ['E2E Acme', 'E2E Beta', 'E2E Nimbus', 'E2E Orbit'];
    if (JSON.stringify(crawl) !== JSON.stringify(wanted)) throw new Error(`the crawl would read [${crawl}], expected [${wanted}]`);
  }, {needs: ctx.needs});

  await ctx.run('a second run writes nothing twice', async () => {
    const rowsBefore = (await readRows(NOTION, 'Employers & Sources')).length;
    state.second = await findEmployers(ctx);
    console.log(`  second run: ${JSON.stringify(state.second)}`);
    if (state.second.length !== 1 || state.second[0].ok === false) throw new Error(`the second click gave ${state.second.length} run(s): ${JSON.stringify(state.second)}`);
    const after = engineState(ctx);
    const rows = await readRows(NOTION, 'Employers & Sources');
    const twice = duplicates(rows);
    if (twice.length) throw new Error(`Employers & Sources lists ${twice.join(', ')} more than once`);
    if (rows.length !== rowsBefore) throw new Error(`Employers & Sources had ${rowsBefore} rows and now has ${rows.length}`);
    if (after.registered.length !== state.first.registered.length) throw new Error(`the second run registered ${after.registered.length - state.first.registered.length} more source(s)`);
    const line = parseRunLine(state.second[0].result);
    if (!line || line.checked !== 0 || line.added !== 0) throw new Error(`the second run says "${state.second[0].result}": everything was checked, so it should say checked 0 and no new sources`);
  }, {needs: ctx.needs});

  await ctx.run('a Sonnet judge finds each added employer sensible for the candidate', async () => {
    const added = state.rows.filter(row => row.Active === true);
    const items = added.map(row => ({name: row.Company, board: row.ATS, quality: row.Quality, cities: row.Cities, why: row.Notes, relevantRoles: row['Relevant roles'], inPreferredPlaces: row['In preferred places']}));
    if (items.length !== 2) throw new Error(`expected two added employers to judge, found ${items.length}`);
    const verdicts = await judge({key: ctx.key, person: PERSON, items});
    console.log(`  judge: ${verdicts.map(item => `${item.name}: ${item.makes_sense ? 'yes' : 'NO'} (${item.reason})`).join(' | ')}`);
    const problems = judgeProblems(items.map(item => item.name), verdicts);
    if (problems.length) throw new Error(problems.join('; '));
  }, {needs: ctx.needs});

  await ctx.run('the Actions page renders without layout problems after the runs', async () => {
    await visit(ctx, ['actions']);
    finish(ctx);
  }, {needs: ctx.needs});
}
