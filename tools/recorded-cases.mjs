#!/usr/bin/env node
// Pre-push check (tools/pre-push-check.sh), owner 10 Oct 2026: "never fix the same website twice"; tightened 12 Oct 2026 ("every fix to how the app acts on a page lands with a case that FAILS on the old code").
// A COVERED file is one a recorded replay loads (tools/replay-files.mjs: the extension's files and the app's desktop/lib modules, found by structure) or an extension file of the flow (desktop/e2e/flows.mjs FLOW_FILES).
// A push that changes one adds or changes a recorded page (desktop/e2e/recorded/, layer 2) or a journey scenario (desktop/test/journeys.test.js, layer 1), or each such commit says "Recorded-unneeded: <why>".
// "Recorded-unneeded:" is only for a change that fixes no failure seen: a commit that touches a covered file AND names a pool row ("Pool-row:") or an issue ("Fixes/Closes/Resolves/Refs #N") cannot use it.
// A recorded page the push adds or changes must FAIL on the code before the push (tools/recorded-fails-on-old.mjs, a replay on origin/main's code): a case that passes on the old code proves nothing.
// A field-level fill replay (worker/test/fixtures/fill/) is NOT proof (owner, 10 Oct 2026): it never reaches the Fixed-site replays list on /admin/applying.
//   node tools/recorded-cases.mjs [--base origin/main]      exit 1 with the reason. Guard: desktop/test/recorded-cases.test.js.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {replayFiles} from './replay-files.mjs';

export const PROOF = /^desktop\/(e2e\/recorded\/|test\/journeys\.test\.js$)/;   // a recorded page or a scenario
export const TRAILER = /^Recorded-unneeded:\s*\S/m;
export const NAMES_A_FAILURE = /^Pool-row:[ \t]*\S|^(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?|refs?)[ \t]+#\d+/im;   // a pool row, or an issue, the commit answers to
export const RECORDED_CASE = /^desktop\/e2e\/recorded\/([^/]+)\//;

// The recorded cases (folder names) a push adds or changes.
export const casesOf = changed => [...new Set(changed.map(file => RECORDED_CASE.exec(file)?.[1]).filter(Boolean))];

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
    commits = git('rev-list', '--reverse', `${base}..HEAD`).split('\n').filter(Boolean).map(sha => ({sha, message: git('log', '-1', '--format=%B', sha), files: git('diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha).split('\n').filter(Boolean)}));
  } catch { return 0; }
  const {FLOW_FILES} = await import(path.join(root, 'desktop/e2e/flows.mjs'));
  const covered = new Set([...replayFiles(root), ...FLOW_FILES.filter(file => file.startsWith('extension/'))]);
  const why = missingCase(commits, covered);
  if (why) { console.error(why); return 1; }
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await main());
