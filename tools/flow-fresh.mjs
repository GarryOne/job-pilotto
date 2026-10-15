#!/usr/bin/env node
// The flow-files claim, automatic (owner, 12 Oct 2026): the open pull request IS the claim on the applying flow's files, no message to the peers.
//   node tools/flow-fresh.mjs [--base origin/main] [--head HEAD] [--others] [--root <repo>]
// Fails (exit 1, the reason and the files) when main changed, since this PR's base, a flow file (FLOW_FILES + FLOW_CORE of desktop/e2e/flows.mjs) that the PR also changes:
// two PRs that are each green must never merge an untested combination of flow edits. tools/ship.sh rebases on this failure by itself and pushes again, so the checks run on the combination.
// --others (needs gh) lists the other open pull requests that change the same flow files: said, never a failure (they are told by the same check when they meet it).
// Required check "Core flow files up to date with main" of .github/workflows/pr-gate.yml. Guard: desktop/test/flow-fresh.test.js.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FLOW_CORE, FLOW_FILES} from '../desktop/e2e/flows.mjs';

const flowSet = new Set([...FLOW_FILES, ...FLOW_CORE]);
export const flowTouched = files => files.filter(file => flowSet.has(file));
// Flow files both lists change. mine: what the PR changes; theirs: what main changed since the PR's base.
export const clashes = (mine, theirs) => { const main = new Set(flowTouched(theirs)); return flowTouched(mine).filter(file => main.has(file)); };
export const message = (files, base) => `flow-fresh: ${base} changed ${files.length} flow file${files.length > 1 ? 's' : ''} this change also changes since its base: ${files.join(', ')}.\n`
  + 'Rebase on the new main and push again (tools/ship.sh does it by itself): the checks must run on the combination, not on each side alone.';

const run = (root, cmd, args) => execFileSync(cmd, args, {cwd: root, encoding: 'utf8', maxBuffer: 64 << 20});
const lines = text => text.split('\n').map(line => line.trim()).filter(Boolean);

function main() {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const base = arg('--base', 'origin/main'), head = arg('--head', 'HEAD');
  const root = path.resolve(arg('--root', path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')));
  const git = (...rest) => run(root, 'git', rest);
  const mergeBase = git('merge-base', base, head).trim();
  const mine = lines(git('diff', '--name-only', mergeBase, head));
  const theirs = lines(git('diff', '--name-only', mergeBase, base));
  if (args.includes('--others') && flowTouched(mine).length) {
    try {
      const open = JSON.parse(run(root, 'gh', ['pr', 'list', '--base', 'main', '--state', 'open', '--json', 'number,headRefName,files', '--limit', '50']));
      for (const pr of open) {
        const shared = flowTouched(mine).filter(file => (pr.files || []).some(entry => entry.path === file));
        if (shared.length && !(process.env.GITHUB_HEAD_REF && pr.headRefName === process.env.GITHUB_HEAD_REF)) console.log(`flow-fresh: open PR #${pr.number} (${pr.headRefName}) also changes ${shared.join(', ')}`);
      }
    } catch { /* no gh or no network: the list is only a courtesy */ }
  }
  const files = clashes(mine, theirs);
  if (files.length) { console.error(message(files, base)); process.exit(1); }
  console.log(`flow-fresh: ok (${flowTouched(mine).length} flow file${flowTouched(mine).length === 1 ? '' : 's'} changed, none changed on ${base} since the base)`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
