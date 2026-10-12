#!/usr/bin/env node
// The spec-proof gate (owner, 12 Oct 2026, via cc: a ticked box with no proof made a step look done): a box a pull request ticks in a spec's "## Progress" names its proof,
// and the pull request contains that file. Boxes ticked before the PR are never asked; a ticked box whose words the PR edits counts as ticked by it.
//   - [x] <what> (proof: <path>[, <path>])            each path is changed by this pull request and exists
//   - [x] <what> (proof: <path> @<sha>)               landed earlier: that commit, on main, changes the path
//   - [x] <what> (proof: none: <why>)                 no file can show it (an owner's decision)
// Usage: node tools/spec-proof.mjs [--base origin/main]   exit 1 with the reasons. Run by tools/pre-push-check.sh (pure checks; CI's "pr gates"). Guard: desktop/test/spec-proof.test.js.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HOW = 'Name the proof on the ticked line: "(proof: <path>)" for a file this pull request changes, "(proof: <path> @<sha>)" for one a commit on main changed, or "(proof: none: <why>)".';
const progressBoxes = text => {
  const out = [];
  let inside = false;
  for (const line of String(text || '').split('\n')) {
    if (/^##\s/.test(line)) inside = /^##\s+Progress\b/i.test(line);
    else if (inside && /^\s*[-*]\s+\[[xX]\]\s/.test(line)) out.push(line.trimEnd());
  }
  return out;
};
// The Progress boxes ticked in head that were not ticked, with the same words, in base.
export function newlyTicked(base, head) {
  const before = new Set(progressBoxes(base));
  return progressBoxes(head).filter(line => !before.has(line));
}

const proofOf = line => (/\(\s*proof:\s*([^)]*)\)/i.exec(line) || /\bproof:\s*(.+)$/i.exec(line) || [])[1]?.trim() ?? null;
const short = line => line.replace(/^\s*[-*]\s+\[[xX]\]\s+/, '').slice(0, 90);

// specs: [{file, base, head}]; changed: Set of the PR's files; touchedBy(sha, file): that commit is on main and changes the file; exists(file). -> [problem]
export function proofProblems(specs, {changed, touchedBy, exists}) {
  const problems = [];
  for (const {file, base, head} of specs) {
    for (const line of newlyTicked(base, head)) {
      const at = `${file}: "${short(line)}"`, proof = proofOf(line);
      if (proof == null || !proof) { problems.push(`${at} names no proof`); continue; }
      if (/^none\b/i.test(proof)) { if (!/^none:\s*\S.{2,}/i.test(proof)) problems.push(`${at}: "proof: none" needs a reason ("proof: none: <why>")`); continue; }
      for (const item of proof.split(/\s*,\s*/).filter(Boolean)) {
        const [target, sha] = item.split(/\s+@/);
        if (!exists(target)) problems.push(`${at}: ${target} does not exist`);
        else if (sha) { if (!touchedBy(sha.trim(), target)) problems.push(`${at}: commit ${sha.trim()} on main does not change ${target}`); }
        else if (!changed.has(target)) problems.push(`${at}: ${target} is not changed by this pull request (name the commit on main that did: "${target} @<sha>")`);
      }
    }
  }
  return problems;
}

function main() {
  const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'origin/main';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const git = (...rest) => execFileSync('git', ['-C', root, ...rest], {encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore']});
  let changed;
  try { changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean); } catch { return 0; }   // no base here: nothing to compare (the hook's own rule)
  const specs = changed.filter(file => file.endsWith('.md') && fs.existsSync(path.join(root, file))).map(file => {
    let before = '';
    try { before = git('show', `${base}:${file}`); } catch { /* a new spec */ }
    return {file, base: before, head: fs.readFileSync(path.join(root, file), 'utf8')};
  }).filter(one => /^##\s+Progress\b/im.test(one.head));
  const touchedBy = (sha, file) => { try { git('merge-base', '--is-ancestor', sha, base); return git('show', '--name-only', '--format=', sha).split('\n').includes(file); } catch { return false; } };
  const problems = proofProblems(specs, {changed: new Set(changed), touchedBy, exists: file => fs.existsSync(path.join(root, file))});
  if (problems.length) { console.error(`this pull request ticks Progress boxes without their proof:\n${problems.map(line => `  - ${line}`).join('\n')}\n${HOW}`); return 1; }
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main());
