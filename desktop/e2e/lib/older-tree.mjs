// The build before a fix, for "Confirmed offline" (verify-row.mjs): main's tools and app with that commit's extension laid over as a UNION (its files replace, files only main has stay), because main's harness
// and app read extension files the old commit lacks (option-groups.js, 15 Oct 2026). Files desktop/scripts/stage.mjs copies into the app stay main's: the app imports their exports (whyWord). Guard: e2e/test/older-tree.test.mjs.
import {execFileSync} from 'node:child_process';

// extension/ files the app takes a copy of (stage.mjs) and the two files that change with every commit (the version and its hash). Test: every file stage.mjs copies is here.
export const SHARED = ['extension/recipe-schema.js', 'extension/alias-schema.js', 'extension/ladder/core.js', 'extension/ladder/endings.js', 'extension/ladder/control-ending.js', 'extension/manifest.json', 'extension/fingerprint.json'];

const gitIn = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();

// Does a fix commit change one of the shared files? Then the build before it cannot be told from main by the extension alone. -> the files, or [].
export function sharedTouched(commit, git = (...args) => gitIn(process.cwd(), ...args)) {
  return git('diff', '--name-only', `${commit}^`, commit, '--', ...SHARED).split('\n').filter(Boolean).filter(file => !/manifest\.json$|fingerprint\.json$/.test(file));
}

// Lays `commit`'s extension over `tree` (a checkout of main): the old files in, main's shared files back.
export function overlayExtension(tree, commit) {
  gitIn(tree, 'checkout', commit, '--', 'extension');
  const here = gitIn(tree, 'ls-tree', '-r', '--name-only', 'HEAD', '--', ...SHARED).split('\n').filter(Boolean);   // a shared file main does not have (an older checkout) is skipped
  if (here.length) gitIn(tree, 'checkout', 'HEAD', '--', ...here);
}
