// When the pool's smoke may run on CI (owner: 11 Oct 2026 "by hand only"; 12 Oct 2026 also on a GitHub runner, by hand). 13 Oct 2026 (owner: "I don't want
// PR to generate an AI cost"): the PR live proof and the flow canary that called it were removed; it starts BY HAND only, and no pull request workflow can
// reach an AI key or the pool run. A new trigger, a caller or a PR workflow with an AI key fails here, with the workflow's name.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.github', 'workflows');
const workflows = Object.fromEntries(fs.readdirSync(DIR).filter(name => /\.ya?ml$/.test(name)).map(name => [name, fs.readFileSync(path.join(DIR, name), 'utf8')]));
export const triggersOf = text => [...(text.match(/^on:\n((?:[ \t]+.*\n|\n)*)/m)?.[1] || '').matchAll(/^ {2}([a-z_]+):/gm)].map(match => match[1]);

test('a workflow that records the pool sites starts by hand only: never a schedule, a push, a call or a PR', () => {
  const runners = Object.keys(workflows).filter(name => /(^|[\s/'"])smoke\.mjs\b|npm run smoke\b/m.test(workflows[name]));
  assert.deepEqual(runners, ['record-sites.yml']);
  assert.deepEqual(triggersOf(workflows['record-sites.yml']), ['workflow_dispatch']);
  const callers = Object.keys(workflows).filter(name => /uses: \.\/\.github\/workflows\/record-sites\.yml/.test(workflows[name]));
  assert.deepEqual(callers, [], 'no workflow calls the pool run');
});

// The class (owner, 13 Oct 2026): no workflow a pull request starts can spend AI: no AI key, no live pool run, no claude CLI.
test('no pull request workflow can reach an AI key or the live pool', () => {
  const onPr = Object.keys(workflows).filter(name => triggersOf(workflows[name]).some(t => t === 'pull_request' || t === 'pull_request_target'));
  assert.ok(onPr.length > 0, 'the reader finds the PR workflows (positive control)');
  for (const name of onPr) {
    assert.doesNotMatch(workflows[name], /secrets\.[A-Z_]*(ANTHROPIC|OPENAI)[A-Z_]*|secrets: inherit|record-sites\.yml|\bclaude -p\b/, `${name}: a PR workflow must not spend AI`);
  }
});

test('the trigger reader sees a trigger added to either file (positive control)', () => {
  const smoke = workflows['record-sites.yml'];
  assert.deepEqual(triggersOf(smoke.replace('on:\n', 'on:\n  schedule:\n    - cron: "0 3 * * *"\n')), ['schedule', 'workflow_dispatch']);
});

// 12 Oct 2026: two dispatches in the same second, and GitHub's shared concurrency group cancelled the older pending one (Ocado). The queue never drops a run.
test('no pool run is dropped: no concurrency group (GitHub cancels a pending run in it); a queue step waits for earlier runs before anything else is read', () => {
  const smoke = workflows['record-sites.yml'];
  assert.doesNotMatch(smoke, /^\s*concurrency:/m, 'record-sites.yml: a concurrency group cancels a waiting run');
  const wait = smoke.indexOf('pool-ci-wait.mjs'), states = smoke.indexOf('pool-ci-state.mjs prepare');
  assert.ok(wait > 0 && wait < states, 'the queue step runs before the earlier runs\' states are read');
  assert.ok(Number(smoke.match(/timeout-minutes: (\d+)/)?.[1]) >= 75, 'the job has time to wait its turn');
});

// The NOT RUN line also reaches the PR as a comment, so its author knows to run it again when the visit is possible.
test('a PR whose row did not run gets the NOT RUN line as a comment, with how to run it again', () => {
  const smoke = workflows['record-sites.yml'];
  const step = smoke.match(/- name: [^\n]*did not run[^\n]*\n(?: {8}.*\n)+/)?.[0] || '';
  assert.match(step, /if: always\(\) && github\.event_name == 'pull_request'/);
  assert.match(step, /gh pr comment "\$PR_NUMBER"/);
  assert.match(step, /NOT_RUN_FILE/);
  assert.match(smoke, /NOT_RUN_FILE: \$\{\{ runner\.temp \}\}\/not-run\.txt/);
  assert.match(smoke, /^ {2}pull-requests: write\b/m);
});

test('the pool run sets JP_APPLICANT (thin when started by hand)', () => {
  assert.match(workflows['record-sites.yml'], /^ +JP_APPLICANT: thin\b/m);
});

// Owner, 12 Oct 2026: a by-hand run keeps a host's last CI visit of the day for a PR proof (lib/site-ledger.mjs JOB_PILOTTO_SITE_RESERVE).
test('the pool run names its visit kind (a PR proof or by hand) and keeps one visit a day for PR proofs', () => {
  const smoke = workflows['record-sites.yml'];
  assert.match(smoke, /JOB_PILOTTO_VISIT_KIND: \$\{\{ github\.event_name == 'pull_request' && 'proof' \|\| 'hand' \}\}/);
  assert.match(smoke, /JOB_PILOTTO_SITE_RESERVE: '1'/);
  assert.match(smoke, /JOB_PILOTTO_SITE_LIMIT: '2'/);
});

// Owner, 14 Oct 2026: the CI workflow's one job is recording, so its rows move /admin/applying (main only, the narrow key); it sends no "proven live" record any more.
test('the recording run sends its ladder moves, endings and (main only) its rows with the narrow key, on that step only, never the site key', () => {
  const smoke = workflows['record-sites.yml'];
  const step = smoke.match(/- name: The ladder moves, the rows' endings[^\n]*\n(?: {8}.*\n)+/)?.[0] || '';
  assert.match(step, /REPLAYS_PUBLISH_KEY: \$\{\{ secrets\.REPLAYS_PUBLISH_KEY \}\}/);
  assert.match(step, /\[ "\$GITHUB_REF" = "refs\/heads\/main" \] && node desktop\/e2e\/pool-ci-rows\.mjs/);   // the rows' results, a run on main only
  assert.doesNotMatch(smoke, /pool-proven|proven live/i, 'a recording run proves nothing live: the fix verdict is offline');
  assert.match(step, /node desktop\/e2e\/pool-moves\.mjs/);   // the ladder moves, marked source ci (lib/ladder-moves.mjs)
  assert.match(step, /node desktop\/e2e\/pool-endings\.mjs/);   // each row's ending (lib/pool-endings.mjs)
  assert.equal((smoke.match(/REPLAYS_PUBLISH_KEY: \$\{\{/g) || []).length, 1, 'the key sits on that one step');
  assert.doesNotMatch(smoke, /STATS_API_KEY|STATS_KEY|site\.api_key/);
});

// Owner, 12 Oct 2026 (cost safety): live CI has its own Anthropic key with its own limit; the Tests key until it exists. Every run reports its spend to /admin/ai-cost.
test('the pool run passes its live keys to the engine rule (which picks one, else the Tests key, and names it), and reports its spend to /admin/ai-cost without ever failing', () => {
  const smoke = workflows['record-sites.yml'];
  for (const name of ['E2E_ANTHROPIC_KEY', 'LIVE_POOL_ANTHROPIC_KEY', 'PR_PROOF_ANTHROPIC_KEY']) assert.match(smoke, new RegExp(`\\b${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`), `${name} reaches the run; lib/engine.mjs picks one`);
  assert.doesNotMatch(smoke, /AI_KEY_NAME|secrets\.LIVE_ANTHROPIC_KEY/, 'the choice is the engine rule\'s alone (lib/engine.mjs liveKeyName)');
  const step = smoke.match(/- name: Report the run's AI spend[^\n]*\n(?: {8}.*\n)+/)?.[0] || '';
  assert.match(step, /if: always\(\)/);
  assert.match(step, /AI_COST_PUBLISH_KEY: \$\{\{ secrets\.AI_COST_PUBLISH_KEY \}\}/);
  assert.match(step, /github\.event_name == 'pull_request' && 'pr-live-proof' \|\| 'pool-live'/);
  assert.match(step, /node desktop\/e2e\/pool-ai-cost\.mjs[^\n]*&& node desktop\/e2e\/ai-cost-report\.mjs --job "\$AI_COST_JOB" --file[^\n]*\|\| true/);
});
