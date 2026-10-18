// The Lab Job Search's automatic tape heal (owner, 18 Oct 2026: "after a search change, capped", "keep the old green until 2 replays agree", $6 a week): `pick` finds the first candidate whose
// tape no longer covers this build (an offline replay, $0) unless the week's cap is spent; `verify` accepts a re-recorded tape only when two replays of it are not stale and agree.
// Pure parts are exported for tests/test_search_lab_heal.py; the workflow is .github/workflows/search-lab-heal.yml.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile, execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {fetch, replayMisses, staleNote} from './tape-store.mjs';

export const ORDER = ['driver', 'finance', 'music', 'sre', 'cluj', 'chisinau'];
export const WEEKLY_CAP = 6;   // one heal costs about $0.92 (measured 18 Oct 2026, driver): six is about $5.5, under the owner's $6 a week

// stale: candidate -> stale sentence ('' = covered). Returns the first stale candidate in ORDER, or null (nothing stale, or the cap is spent).
export function pickCandidate(stale, healedThisWeek, cap = WEEKLY_CAP) {
  if (healedThisWeek >= cap) return null;
  return ORDER.find(name => stale[name]) || null;
}

// Two replays of the new tape agree when neither is stale or crashed and they count the same jobs (a replay of one tape is deterministic).
export function agree(a, b) {
  if (!a || !b) return 'a replay produced no press';
  for (const [name, press] of [['first', a], ['second', b]]) {
    if (press.stale) return `the ${name} replay is stale: ${press.stale}`;
    if ((press.crashes || []).length) return `the ${name} replay crashed`;
  }
  for (const field of ['in_places', 'scored_in_places', 'fit70_in_places']) if (a[field] !== b[field]) return `${field} differs: ${a[field]} vs ${b[field]}`;
  return '';
}

const sh = (cmd, args, options = {}) => execFileSync(cmd, args, {encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'inherit'], ...options});

const run = promisify(execFile);

// An offline replay of a tape folder, the way its tape says (tape/replay.json: engine and wait scale, read by run.mjs; the heal writes it for a tape it recorded on the API engine, at the recorded pace).
// Its report.jsonl is cleared first: every replay appends to it. Returns the press with `stale` set.
export async function replay(candidate, tape, out) {
  fs.rmSync(path.join(tape, 'report.jsonl'), {force: true});
  fs.rmSync(out, {recursive: true, force: true});
  sh('python3', ['tools/persona-search/personas.py', out]);
  const args = [candidate, out, '--presses', '1', '--tag', 'heal-check', '--fresh', '--draft', path.join(tape, 'draft.json'), '--tape', tape, '--replay', '--no-live'];
  try { await run('node', ['tools/persona-search/run.mjs', ...args], {maxBuffer: 1 << 28}); } catch { /* a crashed replay still leaves its press */ }
  const file = path.join(out, candidate, 'presses.jsonl');
  if (!fs.existsSync(file)) return null;
  const press = JSON.parse(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)[0]);
  const report = path.join(tape, 'report.jsonl');
  press.stale = staleNote(fs.existsSync(report) ? replayMisses(fs.readFileSync(report, 'utf8')) : {ai: 0, web: 0, webTape: 0});
  return press;
}

// Heals that finished in the last 7 days: runs of this workflow whose `heal` job succeeded (a run that picked nothing skips it).
function healedThisWeek() {
  const since = Date.now() - 7 * 86400000;
  const list = JSON.parse(sh('gh', ['run', 'list', '--workflow', 'search-lab-heal.yml', '--status', 'success', '--limit', '60', '--json', 'databaseId,createdAt']));
  return list.filter(run => Date.parse(run.createdAt) >= since).filter(run => {
    const jobs = JSON.parse(sh('gh', ['run', 'view', String(run.databaseId), '--json', 'jobs'])).jobs;
    return jobs.some(job => job.name === 'heal' && job.conclusion === 'success');
  }).length;
}

async function main([action, ...rest]) {
  if (action === 'pick') {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-heal-')), stale = {};
    await Promise.all(ORDER.map(async name => {   // together: a tape on the API engine replays at the recorded pace
      try {
        const tape = path.join(work, name, 'tape');
        fetch(name, tape);
        stale[name] = (await replay(name, tape, path.join(work, name, 'out')))?.stale || 'no press';
      } catch (error) { stale[name] = `no usable tape: ${error.message}`; }
    }));
    for (const name of ORDER) console.log(`heal-pick: ${name}: ${stale[name] || 'covered'}`);
    const healed = healedThisWeek(), picked = pickCandidate(stale, healed);
    console.log(`heal-pick: ${healed} of ${WEEKLY_CAP} heals used this week; picked ${picked || 'none'}`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `candidate=${picked || ''}\n`);
  } else if (action === 'verify') {
    const [candidate, tape, work] = rest, copies = await Promise.all(['a', 'b'].map(name => {
      const copy = path.join(work, `tape-${name}`);
      fs.cpSync(tape, copy, {recursive: true});
      return replay(candidate, copy, path.join(work, `out-${name}`));
    }));
    const problem = agree(...copies);
    console.log(problem ? `heal-verify: NOT accepted: ${problem}` : `heal-verify: two replays agree (${copies[0].in_places} in places, ${copies[0].fit70_in_places} scoring 70+)`);
    process.exit(problem ? 1 : 0);
  } else { console.error('usage: node tools/persona-search/heal.mjs pick | verify <candidate> <tape> <workdir>'); process.exit(2); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) await main(process.argv.slice(2));
