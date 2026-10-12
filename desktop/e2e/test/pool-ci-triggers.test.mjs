// When the pool's smoke may run on CI (owner: 11 Oct 2026 "by hand only"; 12 Oct 2026 also on a GitHub runner, by hand; 12 Oct 2026 v2: the live proof of ONE row a
// PR names). A workflow that runs the smoke starts by hand (workflow_dispatch) or is called (workflow_call); the only caller is the PR proof (pull_request:
// opened, synchronize, reopened, labeled). Never a schedule or a push. A new trigger or a new caller fails here, with the workflow's name.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.github', 'workflows');
const workflows = Object.fromEntries(fs.readdirSync(DIR).filter(name => /\.ya?ml$/.test(name)).map(name => [name, fs.readFileSync(path.join(DIR, name), 'utf8')]));
export const triggersOf = text => [...(text.match(/^on:\n((?:[ \t]+.*\n|\n)*)/m)?.[1] || '').matchAll(/^ {2}([a-z_]+):/gm)].map(match => match[1]);
const typesOf = text => (text.match(/^ {2}pull_request:\n {4}types: \[([^\]]*)\]/m)?.[1] || '').split(',').map(type => type.trim()).filter(Boolean);

test('a workflow that runs the pool smoke starts by hand or is called: never a schedule, a push or a PR of its own', () => {
  const runners = Object.keys(workflows).filter(name => /(^|[\s/'"])smoke\.mjs\b|npm run smoke\b/m.test(workflows[name]));
  assert.deepEqual(runners, ['pool-smoke.yml']);
  for (const name of runners) assert.deepEqual(triggersOf(workflows[name]), ['workflow_dispatch', 'workflow_call'], `${name}: ${triggersOf(workflows[name]).join(', ')}`);
});

test('the only caller is the PR live proof, on open, push, reopen and a label: never a schedule or a push to a branch', () => {
  const callers = Object.keys(workflows).filter(name => /uses: \.\/\.github\/workflows\/pool-smoke\.yml/.test(workflows[name]));
  assert.deepEqual(callers, ['pool-proof.yml']);
  assert.deepEqual(triggersOf(workflows['pool-proof.yml']), ['pull_request']);
  assert.deepEqual(typesOf(workflows['pool-proof.yml']), ['opened', 'synchronize', 'reopened', 'labeled']);
});

test('the trigger reader sees a trigger added to either file (positive control)', () => {
  const smoke = workflows['pool-smoke.yml'];
  assert.deepEqual(triggersOf(smoke.replace('on:\n', 'on:\n  schedule:\n    - cron: "0 3 * * *"\n')), ['schedule', 'workflow_dispatch', 'workflow_call']);
  assert.deepEqual(triggersOf(workflows['pool-proof.yml'].replace('on:\n', 'on:\n  push:\n    branches: [main]\n')), ['push', 'pull_request']);
});

// Owner, 12 Oct 2026: every PR that gets a CI live run carries the "live-proof" label ("label:live-proof" lists them all), whether a Pool-row line or the label
// started it. The pick job adds it when it names a row; GitHub starts no new run for a label its own token adds, so this never runs the row twice.
test('the PR proof labels its PR "live-proof" whenever it names a row, with the right to write it', () => {
  const proof = workflows['pool-proof.yml'];
  const step = proof.match(/- name: [^\n]*live-proof[^\n]*\n(?: {8}.*\n)+/)?.[0] || '';
  assert.match(step, /if: steps\.pick\.outputs\.row != ''/, 'only when a row runs');
  assert.match(step, /labels\[\]=live-proof|--add-label live-proof/, 'adds the live-proof label');
  assert.match(step, /GH_TOKEN: \$\{\{ github\.token \}\}/, 'with the run\'s own token (no new run from the label)');
  assert.match(proof, /^ {2}pull-requests: write\b/m);
});

// 12 Oct 2026: two dispatches in the same second, and GitHub's shared concurrency group cancelled the older pending one (Ocado). The queue never drops a run.
test('no pool run is dropped: no concurrency group (GitHub cancels a pending run in it); a queue step waits for earlier runs before anything else is read', () => {
  const smoke = workflows['pool-smoke.yml'], proof = workflows['pool-proof.yml'];
  for (const [name, text] of [['pool-smoke.yml', smoke], ['pool-proof.yml', proof]]) assert.doesNotMatch(text, /^\s*concurrency:/m, `${name}: a concurrency group cancels a waiting run`);
  const wait = smoke.indexOf('pool-ci-wait.mjs'), states = smoke.indexOf('pool-ci-state.mjs prepare');
  assert.ok(wait > 0 && wait < states, 'the queue step runs before the earlier runs\' states are read');
  assert.ok(Number(smoke.match(/timeout-minutes: (\d+)/)?.[1]) >= 75, 'the job has time to wait its turn');
});

// The NOT RUN line also reaches the PR as a comment, so its author knows to run it again when the visit is possible.
test('a PR whose row did not run gets the NOT RUN line as a comment, with how to run it again', () => {
  const smoke = workflows['pool-smoke.yml'];
  const step = smoke.match(/- name: [^\n]*did not run[^\n]*\n(?: {8}.*\n)+/)?.[0] || '';
  assert.match(step, /if: always\(\) && github\.event_name == 'pull_request'/);
  assert.match(step, /gh pr comment "\$PR_NUMBER"/);
  assert.match(step, /NOT_RUN_FILE/);
  assert.match(smoke, /NOT_RUN_FILE: \$\{\{ runner\.temp \}\}\/not-run\.txt/);
  assert.match(smoke, /^ {2}pull-requests: write\b/m);
});

test('the PR proof hands its applicant to the pool run, which sets JP_APPLICANT (thin when started by hand)', () => {
  assert.match(workflows['pool-proof.yml'], /applicant: \$\{\{ needs\.pick\.outputs\.applicant \}\}/);
  assert.match(workflows['pool-smoke.yml'], /JP_APPLICANT: \$\{\{ inputs\.applicant \|\| 'thin' \}\}/);
});

// Owner, 12 Oct 2026: a by-hand run keeps a host's last CI visit of the day for a PR proof (lib/site-ledger.mjs JOB_PILOTTO_SITE_RESERVE).
test('the pool run names its visit kind (a PR proof or by hand) and keeps one visit a day for PR proofs', () => {
  const smoke = workflows['pool-smoke.yml'];
  assert.match(smoke, /JOB_PILOTTO_VISIT_KIND: \$\{\{ github\.event_name == 'pull_request' && 'proof' \|\| 'hand' \}\}/);
  assert.match(smoke, /JOB_PILOTTO_SITE_RESERVE: '1'/);
  assert.match(smoke, /JOB_PILOTTO_SITE_LIMIT: '2'/);
});

// Owner, 12 Oct 2026: a merged fix is "proven live" on /admin/applying only when CI REALLY ran its row; each such run sends one record with the narrow key.
test('the pool run sends its proven-live records and its ladder moves with the narrow key, on that step only, never the site key', () => {
  const smoke = workflows['pool-smoke.yml'];
  const step = smoke.match(/- name: Send a "proven live" record[^\n]*\n(?: {8}.*\n)+/)?.[0] || '';
  assert.match(step, /REPLAYS_PUBLISH_KEY: \$\{\{ secrets\.REPLAYS_PUBLISH_KEY \}\}/);
  assert.match(step, /node desktop\/e2e\/pool-proven\.mjs/);
  assert.match(step, /node desktop\/e2e\/pool-moves\.mjs/);   // the ladder moves, marked source ci (lib/ladder-moves.mjs)
  assert.equal((smoke.match(/REPLAYS_PUBLISH_KEY: \$\{\{/g) || []).length, 1, 'the key sits on that one step');
  assert.doesNotMatch(smoke, /STATS_API_KEY|STATS_KEY|site\.api_key/);
});

// Owner, 12 Oct 2026 (via job-pilotto-cc): every PR check required, so the proof is SKIPPED, never red, when its row's site cannot be visited today.
test('the PR proof checks the site before it starts: today\'s CI ledger only when a row is named, the run\'s own rule, a skip with a PR comment', () => {
  const proof = workflows['pool-proof.yml'];
  const at = name => proof.indexOf(`- name: ${name}`);
  assert.ok(at('Which pool row this PR names') > 0 && at('Which pool row this PR names') < at('Earlier CI runs -> today\'s site ledger') && at('Earlier CI runs -> today\'s site ledger') < at('Which pool row this PR proves live'), 'name the row, prepare the ledger, then pick');
  assert.match(proof, /- name: Earlier CI runs -> today's site ledger[^\n]*\n {8}if: steps\.named\.outputs\.row != ''/, 'the ledger only when a row is named');
  assert.match(proof, /pool-ci-state\.mjs prepare/, 'prepared as the run prepares it');
  assert.match(proof, /JOB_PILOTTO_SITE_LEDGER_DIR: \$\{\{ steps\.named\.outputs\.row != '' && format\('\{0\}\/site-ledger', runner\.temp\) \|\| '' \}\}/, 'the pick asks the site rule only with a ledger');
  assert.match(proof, /JOB_PILOTTO_SITE_LIMIT: '2'/); assert.match(proof, /JOB_PILOTTO_VISIT_KIND: proof/);
  assert.match(proof, /if: steps\.pick\.outputs\.skipped != ''[\s\S]*?gh pr comment "\$PR_NUMBER"/, 'a skipped proof says so on the PR, with when to retry');
  assert.match(proof, /^ {2}proof:\n {4}needs: pick\n {4}if: needs\.pick\.outputs\.row != ''/m, 'no row: the proof job is skipped (a skipped required check never blocks a merge)');
  assert.match(workflows['pool-smoke.yml'], /pool-ci-summary\.mjs/);   // a NOT RUN at run time on a proof is not red: lib/pool-ci.mjs summary({proof}), from JOB_PILOTTO_VISIT_KIND
});

// Owner, 12 Oct 2026 (cost safety): live CI has its own Anthropic key with its own limit; the Tests key until it exists. Every run reports its spend to /admin/ai-cost.
test('the pool run passes its live keys to the engine rule (which picks one, else the Tests key, and names it), and reports its spend to /admin/ai-cost without ever failing', () => {
  const smoke = workflows['pool-smoke.yml'];
  for (const name of ['E2E_ANTHROPIC_KEY', 'LIVE_POOL_ANTHROPIC_KEY', 'PR_PROOF_ANTHROPIC_KEY']) assert.match(smoke, new RegExp(`\\b${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`), `${name} reaches the run; lib/engine.mjs picks one`);
  assert.doesNotMatch(smoke, /AI_KEY_NAME|secrets\.LIVE_ANTHROPIC_KEY/, 'the choice is the engine rule\'s alone (lib/engine.mjs liveKeyName)');
  const step = smoke.match(/- name: Report the run's AI spend[^\n]*\n(?: {8}.*\n)+/)?.[0] || '';
  assert.match(step, /if: always\(\)/);
  assert.match(step, /AI_COST_PUBLISH_KEY: \$\{\{ secrets\.AI_COST_PUBLISH_KEY \}\}/);
  assert.match(step, /github\.event_name == 'pull_request' && 'pr-live-proof' \|\| 'pool-live'/);
  assert.match(step, /node desktop\/e2e\/pool-ai-cost\.mjs[^\n]*&& node desktop\/e2e\/ai-cost-report\.mjs --job "\$AI_COST_JOB" --file[^\n]*\|\| true/);
});
