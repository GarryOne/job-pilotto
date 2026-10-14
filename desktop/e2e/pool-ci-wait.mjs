// node pool-ci-wait.mjs: the CI pool run waits its turn (lib/pool-ci-queue.mjs): until every earlier run of record-sites.yml (and of its old name pool-smoke.yml) has finished, looking
// every POOL_WAIT_POLL seconds (default 20), at most POOL_WAIT_MAX seconds (default 3600; then exit 1, a harness error, never a run beside another).
// Needs gh with GH_TOKEN and GITHUB_RUN_ID (the workflow gives both).
import {execFileSync} from 'node:child_process';
import {runsAhead} from './lib/pool-ci-queue.mjs';

const WORKFLOWS = ['record-sites.yml'], LEGACY = ['pool-smoke.yml'];   // LEGACY: the name until 15 Oct 2026; best effort (a deleted workflow file may not list), a run already queued under it still counts.
const me = process.env.GITHUB_RUN_ID, poll = Number(process.env.POOL_WAIT_POLL || 20), max = Number(process.env.POOL_WAIT_MAX || 3600);
const sleep = seconds => new Promise(resolve => setTimeout(resolve, seconds * 1000));
const legacy = () => LEGACY.flatMap(workflow => { try { return JSON.parse(execFileSync('gh', ['run', 'list', '--workflow', workflow, '--limit', '60', '--json', 'databaseId,status'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']})); } catch { return []; } });
const list = () => WORKFLOWS.flatMap(workflow => {
  try { return JSON.parse(execFileSync('gh', ['run', 'list', '--workflow', workflow, '--limit', '60', '--json', 'databaseId,status'], {encoding: 'utf8'})); }
  catch (error) { console.log(`pool-ci-wait: could not list ${workflow} (${String(error?.stderr || error?.message || error).trim().split('\n').at(-1).slice(0, 240)}): looking again`); return null; }   // gh's own last line says why
});

if (!me) { console.error('pool-ci-wait: no GITHUB_RUN_ID'); process.exit(2); }
const started = Date.now();
let said = '';
for (;;) {
  const runs = list();
  const ahead = runs.includes(null) ? null : runsAhead([...runs, ...legacy()], me);
  if (ahead && !ahead.length) { console.log(`pool-ci-wait: run ${me}'s turn${said ? ` after ${Math.round((Date.now() - started) / 1000)} s` : ''}`); process.exit(0); }
  const now = ahead ? `waiting for ${ahead.length} earlier pool run(s): ${ahead.join(', ')}` : 'waiting: the run list did not answer';
  if (now !== said) { console.log(`pool-ci-wait: ${now}`); said = now; }
  if ((Date.now() - started) / 1000 > max) { console.log(`pool-ci-wait: still not my turn after ${max} s: stopping (a harness error, never a run beside another)`); process.exit(1); }
  await sleep(poll);
}
