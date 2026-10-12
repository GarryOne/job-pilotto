// The live proof on a PR (.github/workflows/pool-proof.yml, lib/pool-proof.mjs): which public pool row a PR's build runs, from its commits' "Pool-row:" lines, the
// "live-proof" label and a "live-row:" line in the PR body; a private row, a fork or no row named is a neutral line, never a silent skip and never a guess.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {LABEL, pickProofRow} from '../lib/pool-proof.mjs';

const publicNames = ['Lever: single page, no account', 'Personio form in German', 'Recruitee form', 'Recruitee: one-page form on recruitee.com'];
const fix = row => `Fix the Lever upload slot\n\nBody.\n\nPool-row: ${row}\nCo-Authored-By: x`;

test('a commit\'s Pool-row line runs that row on open and on each push; the first named row wins', () => {
  assert.deepEqual(pickProofRow({action: 'opened', messages: [fix('Lever: single page, no account'), fix('Personio form in German')], publicNames}),
    {row: 'Lever: single page, no account', note: 'Pool-row in the PR\'s commits: Lever: single page, no account'});
  assert.equal(pickProofRow({action: 'synchronize', messages: [fix('lever-single-page-no-account')], publicNames}).row, 'Lever: single page, no account', 'a row\'s slug names it too');
  assert.equal(pickProofRow({action: 'synchronize', messages: [fix('none a hand-made case'), fix('Recruitee form')], publicNames}).row, 'Recruitee form', '"none <why>" names no row');
});

test('no Pool-row line and no label: nothing runs, said in one line', () => {
  assert.deepEqual(pickProofRow({action: 'opened', messages: ['A plain change'], publicNames}), {row: '', note: 'no Pool-row line in the commits and no live-proof label: no live proof'});
  assert.deepEqual(pickProofRow({action: 'synchronize', messages: [fix('none a hand-made case')], publicNames}).row, '');
});

test('the live-proof label runs a PR with no Pool-row line; the row comes from "live-row:" in the PR body, which also wins over a Pool-row', () => {
  assert.equal(LABEL, 'live-proof');
  assert.deepEqual(pickProofRow({action: 'labeled', label: 'live-proof', labels: ['live-proof'], body: 'Prompt fix.\n\nlive-row: Personio form\n', messages: ['Tune the answers prompt'], publicNames}),
    {row: 'Personio form in German', note: 'live-row in the PR body: Personio form in German'});
  assert.equal(pickProofRow({action: 'synchronize', labels: ['live-proof'], body: 'live-row: Recruitee form', messages: [fix('Lever: single page, no account')], publicNames}).row, 'Recruitee form');
  assert.equal(pickProofRow({action: 'synchronize', labels: [], body: 'live-row: Recruitee form', messages: ['A plain change'], publicNames}).row, '', 'a body line alone does not start a run: a Pool-row or the label does');
});

test('the label with no row named runs nothing and says how to name one: the row is never guessed', () => {
  assert.deepEqual(pickProofRow({action: 'labeled', label: 'live-proof', labels: ['live-proof'], body: 'No row here.', messages: ['Tune the answers prompt'], publicNames}),
    {row: '', note: 'live-proof: no row named; add "live-row: <row words>" to the PR body (or a "Pool-row:" line to a commit)'});
});

test('another label is not ours: nothing runs and nothing is said', () => {
  assert.deepEqual(pickProofRow({action: 'labeled', label: 'pool-fix', labels: ['pool-fix'], messages: [fix('Lever: single page, no account')], publicNames}), {row: '', note: ''});
});

test('a row not in the repo\'s pool list runs on the Mac where it lives; words matching several rows ask for one; a fork has no secrets', () => {
  assert.deepEqual(pickProofRow({action: 'opened', messages: [fix('Datadog careers (Greenhouse behind its own site)')], publicNames}),
    {row: '', note: 'not in the repo\'s pool: "Datadog careers (Greenhouse behind its own site)" is not in desktop/e2e/smoke-sites.json; add it there, or run it on the Mac: cd desktop/e2e && npm run live -- <its posting>'});
  assert.match(pickProofRow({action: 'labeled', label: 'live-proof', labels: ['live-proof'], body: 'live-row: Recruitee', messages: [], publicNames}).note,
    /^live-row "Recruitee" matches 2 pool rows: name one exactly \(Recruitee form; Recruitee: one-page form on recruitee\.com\)$/);
  assert.deepEqual(pickProofRow({action: 'opened', messages: [fix('Lever: single page, no account')], publicNames, fork: true}), {row: '', note: 'a fork\'s PR has no secrets: no live proof'});
});
