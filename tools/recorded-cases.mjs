#!/usr/bin/env node
// Pre-push check (tools/pre-push-check.sh), owner 10 Oct 2026: "never fix the same website twice"; tightened 12 Oct 2026 ("every fix to how the app acts on a page lands with a case that FAILS on the old code").
// A COVERED file is one a recorded replay loads (tools/replay-files.mjs: the extension's files and the app's desktop/lib modules, found by structure) or any file of the flow (desktop/e2e/flows.mjs FLOW_FILES;
// the ones the replay's app does not load, e.g. desktop/lib/session-flow.js, are proven by a journey scenario, desktop/test/journeys.test.js).
// A push that changes one adds or changes a recorded page (desktop/e2e/recorded/, layer 2) or a journey scenario (desktop/test/journeys.test.js, layer 1), or each such commit says "Recorded-unneeded: <why>".
// "Recorded-unneeded:" is only for a change that fixes no failure seen: a commit that touches a covered file AND names a pool row ("Pool-row:") or an issue ("Fixes/Closes/Resolves/Refs #N") cannot use it.
// A recorded page the push adds or changes must FAIL on the code before the push (tools/recorded-fails-on-old.mjs, a replay on origin/main's code): a case that passes on the old code proves nothing.
// A field-level fill replay (worker/test/fixtures/fill/) is NOT proof (owner, 10 Oct 2026): it never reaches the Fixed-site replays list on /admin/lab-form-filling.
//   node tools/recorded-cases.mjs [--base origin/main]      exit 1 with the reason. Guard: desktop/test/recorded-cases.test.js.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {replayFiles} from './replay-files.mjs';

export const PROOF = /^desktop\/(e2e\/recorded\/|test\/journeys\.test\.js$)/;   // a recorded page or a scenario
export const TRAILER = /^Recorded-unneeded:\s*\S/m;
export const NAMES_A_FAILURE = /^Pool-row:[ \t]*(?!none\b)\S|^(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?|refs?)[ \t]+#\d+/im;   // a pool row (not "none <why>"), or an issue, the commit answers to
export const RECORDED_CASE = /^desktop\/e2e\/recorded\/([^/]+)\//;

// The recorded cases (folder names) a push adds or changes.
// The covered set: what a replay loads, plus every file of the flow.
export const coveredFiles = (root, flowFiles) => new Set([...replayFiles(root), ...flowFiles]);

export const casesOf = changed => [...new Set(changed.map(file => RECORDED_CASE.exec(file)?.[1]).filter(Boolean))];

// Words that describe a case, never what it replays (12 Oct 2026, PR #501: adding `origin` to all 74 cases read as 74 new cases that had to fail on main's code). A case.json edit
// that changes only these brings no case: no proof for a page fix (missingCase), nothing for "cases fail before the fix" (tools/recorded-fails-on-old.mjs, once "hole 3") to replay. The replay reads `shape` and `why`
// only for its test's title and failure message (guard: desktop/test/recorded-cases.test.js).
export const LABEL_KEYS = ['origin', 'shape', 'why'];

// before, after: a case.json's text before and after a commit -> true when only LABEL_KEYS changed (a new, deleted or unreadable case counts).
export function labelOnly(before, after) {
  const strip = text => { const value = JSON.parse(text); for (const key of LABEL_KEYS) delete value[key]; return JSON.stringify(value); };
  try { return Boolean(before && after) && strip(before) === strip(after); } catch { return false; }
}

// The files a commit changed, as both gates read them: a case.json whose edit is labelOnly is left out. git: (...args) -> its output.
export function commitFiles(git, sha) {
  const files = git('diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha).split('\n').filter(Boolean);
  const edited = new Set(git('diff-tree', '--no-commit-id', '--name-only', '-r', '--root', '--diff-filter=M', sha).split('\n').filter(file => file.endsWith('/case.json')));
  return files.filter(file => !(edited.has(file) && labelOnly(git('show', `${sha}^:${file}`), git('show', `${sha}:${file}`))));
}

// A push that ADDS a recorded case names the pool row it fixes ("Pool-row: <row>"), or "Pool-row: none <why>" (a hand-made shape, no row):
// /admin/lab-form-filling's Fixed tab lists fixes by that line (12 Oct 2026: 6 of 8 round-1 fixes had none, the tab showed 2 of 8). -> '' or the message.
export function untaggedNewCases(added, messages) {
  if (!added.length) return '';
  const values = messages.flatMap(message => [...String(message).matchAll(/^Pool-row:[ \t]*(.*)$/gm)].map(found => found[1].trim()));
  if (values.some(value => value && !/^none\b/i.test(value)) || values.some(value => /^none\s+\S/i.test(value))) return '';
  return `this push adds the recorded case${added.length > 1 ? 's' : ''} ${added.join(', ')} but no commit says which pool row ${added.length > 1 ? 'they fix' : 'it fixes'}.
Add to the fix's commit message: "Pool-row: <the row's name as /admin/lab-form-filling shows it>" (the Fixed tab lists fixes by it), or "Pool-row: none <why>" for a hand-made shape no row showed.`;
}

// Any push that changes a file the app acts on pages with names its row too, not only one that adds a case (12 Oct 2026: the prompt fix #424 and a
// harness fix landed with none, so the Fixed tab never saw them). "Pool-row: none <why>" for a refactor, a log line, a pure move.
export function untaggedActing(commits, covered) {
  const cover = new Set(covered);
  const acting = [...new Set(commits.flatMap(commit => commit.files.filter(file => cover.has(file))))];
  if (!acting.length) return '';
  return untaggedNewCases(['__acting__'], commits.map(commit => commit.message)) ? `this push changes how the app acts on pages (${acting.slice(0, 3).join(', ')}${acting.length > 3 ? ', …' : ''}) but no commit names the pool row it fixes.
Add to a commit message: "Pool-row: <the row's name as /admin/lab-form-filling shows it>" (the Fixed tab reads it), or "Pool-row: none <why>" (a refactor, a log line, no row behind it).` : '';
}

// -> '' when fine, else the message. commits: [{files, message}] of the push; covered: the files a replay loads.
export function missingCase(commits, covered) {
  const cover = new Set(covered), acting = commit => commit.files.filter(file => cover.has(file));
  const proof = commits.some(commit => commit.files.some(file => PROOF.test(file)));
  const touched = commits.flatMap(acting);
  if (!touched.length || proof) return '';
  const excused = commits.filter(commit => acting(commit).length && TRAILER.test(commit.message));
  const refused = excused.find(commit => NAMES_A_FAILURE.test(commit.message));
  const bare = commits.filter(commit => acting(commit).length && !TRAILER.test(commit.message));
  if (refused) return `"Recorded-unneeded:" is refused: this commit changes how the app acts on pages (${acting(refused).slice(0, 3).join(', ')}) AND names a failure it fixes (a Pool-row or an issue).
A fix to a seen failure lands with its recorded page, seen failing before the fix: cd desktop/e2e && npm run row-to-case -- "<row>" <case> --old-commit <the fix's sha> (see tools/recorded-cases.mjs).
"Recorded-unneeded: <why>" stays for a commit that touches no file a replay loads (harness, tools, tests), or a covered file with no seen failure behind it (a log line, a comment, a refactor).`;
  if (!bare.length) return '';
  const list = [...new Set(bare.flatMap(acting))];
  return `this push changes how the app acts on pages (${list.slice(0, 4).join(', ')}${list.length > 4 ? ', …' : ''}) without a recorded page or a journey scenario.
Add the case that shows the fix. From a pool row's capture: cd desktop/e2e && npm run row-to-case -- "<row>" <case> --old <old extension/>  (or --old-commit <sha>: the extension without that commit; it scrubs and shrinks the capture, takes expect from the replay, and refuses unless the new build passes and the old build fails; --ask-cold when your fix changes a prompt).
No capture of the row: ask the capture session for one; a hand-built case (twin: npm run twin:drive -- capture <tab> <case> <page> <your worktree>/desktop/e2e/recorded; case.json seen failing on the old build with REAL_EXTENSION_DIR) is the last resort,
or a scenario in desktop/test/journeys.test.js. A fill fixture (worker/test/fixtures/fill/) alone does not count: it is not in the Fixed-site replays list.
The case must FAIL on the build before the fix (REAL_EXTENSION_DIR=<old extension/>) and its stubbed AI must answer only what the extension asked.
Only a change that fixes no failure seen (a log line, a comment, a refactor the gates already cover) may say so: "Recorded-unneeded: <why>" (not with a Pool-row or an issue it fixes).`;
}

async function main() {
  const args = process.argv.slice(2), base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const git = (...rest) => execFileSync('git', ['-C', root, ...rest], {encoding: 'utf8', maxBuffer: 64 << 20});
  let commits;
  try {
    commits = git('rev-list', '--reverse', `${base}..HEAD`).split('\n').filter(Boolean).map(sha => ({sha, message: git('log', '-1', '--format=%B', sha), files: commitFiles(git, sha)}));
  } catch { return 0; }
  const {FLOW_FILES} = await import(path.join(root, 'desktop/e2e/flows.mjs'));
  const covered = coveredFiles(root, FLOW_FILES);
  const added = casesOf(git('diff', '--name-only', '--diff-filter=A', `${base}...HEAD`, '--', 'desktop/e2e/recorded').split('\n').filter(file => file.endsWith('/case.json')));
  const why = missingCase(commits, covered) || untaggedNewCases(added, commits.map(commit => commit.message)) || untaggedActing(commits, covered);
  if (why) { console.error(why); return 1; }
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await main());
