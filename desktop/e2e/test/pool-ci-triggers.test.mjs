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
