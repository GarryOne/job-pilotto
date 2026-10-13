// The extension's version, stamped where the app is packaged (stage.mjs --app), never written in a PR: base + "." + the number of commits
// that changed extension/. Main is linear, so the count only rises and every shipped change of extension/ gets a higher version; Chrome's copy
// reloads itself on a higher one (extension/tab-report.js; 29 Sep 2026: a changed extension with the same version never reached the browser).
// Before 13 Oct 2026 each PR bumped the version itself, and every merge made the other open extension PRs conflict.
//   node desktop/scripts/extension-stamp.mjs      prints the version this checkout's HEAD stamps (CI passes it to the build jobs, which are shallow)
//   node desktop/scripts/extension-stamp.mjs --at <commit>   the version a build of that commit carried (a recorded case's control.build)
// Guarded by desktop/test/extension-stamp.test.js.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The last version a PR committed by hand: every stamp must be above it, or installed copies would stop updating.
export const LAST_COMMITTED = '0.9.270';

export function newer(a, b) {   // the extension's own comparison (extension/background.js)
  const [x, y] = [a, b].map(v => String(v || '0').split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();

// The number of commits on `ref` that changed extension/. A shallow clone would count only what it holds: refused, never a low version.
export function count(repo = REPO, ref = 'HEAD') {
  if (git(repo, 'rev-parse', '--is-shallow-repository') === 'true') {
    throw new Error('a shallow clone cannot count the extension\'s commits: fetch the full history (fetch-depth: 0) or pass EXTENSION_VERSION');
  }
  return Number(git(repo, 'rev-list', '--count', ref, '--', 'extension'));
}

// "0.9.265" or "0.9" → "0.9": the first two parts of the repo manifest's version are the base.
export const base = version => String(version).split('.').slice(0, 2).join('.');

export function version({manifestVersion, commits, floor = LAST_COMMITTED}) {
  if (!Number.isInteger(commits) || commits <= 0) throw new Error(`no extension commit count (${commits})`);
  const stamped = `${base(manifestVersion)}.${commits}`;
  if (!newer(stamped, floor)) throw new Error(`stamped version ${stamped} is not above ${floor}: installed copies would not update`);
  return stamped;
}

// The version this build stamps: EXTENSION_VERSION when CI computed it on a full clone, else counted here.
export function forBuild({repo = REPO, env = process.env, floor = LAST_COMMITTED} = {}) {
  const manifestVersion = JSON.parse(fs.readFileSync(path.join(repo, 'extension', 'manifest.json'), 'utf8')).version;
  if (env.EXTENSION_VERSION) {
    const given = env.EXTENSION_VERSION;
    if (!/^\d+\.\d+\.\d+$/.test(given) || !newer(given, floor)) throw new Error(`EXTENSION_VERSION ${given} is not a version above ${floor}`);
    return given;
  }
  return version({manifestVersion, commits: count(repo), floor});
}

// What a copy made from this checkout reports (the e2e harness's and the twin's copies, the pool's reports, the fix ledger): the stamp at `ref`. On CI a
// shallow clone first fetches the commit history without file contents (~3 s; the replay and harness jobs check out 1-2 commits); elsewhere, or when
// that fails, the manifest's own version. Never throws.
export function stampedAt(repo = REPO, ref = 'HEAD', env = process.env) {
  if (env.CI) { try { if (git(repo, 'rev-parse', '--is-shallow-repository') === 'true') git(repo, 'fetch', '-q', '--unshallow', '--filter=blob:none', 'origin'); } catch { /* counted below, or the fallback */ } }
  let manifestVersion = '';
  try { manifestVersion = JSON.parse(ref === 'HEAD' ? fs.readFileSync(path.join(repo, 'extension', 'manifest.json'), 'utf8') : git(repo, 'show', `${ref}:extension/manifest.json`)).version || ''; } catch { return ''; }
  try { return version({manifestVersion, commits: count(repo, ref), floor: '0'}); } catch { return manifestVersion; }
}

// Writes the version into a copy of the extension (never the repo's own folder).
export function stamp(dir, stamped) {
  const file = path.join(dir, 'manifest.json');
  if (path.resolve(dir) === path.join(REPO, 'extension')) throw new Error('stamp a copy of the extension, not the repo\'s folder');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({...manifest, version: stamped}, null, 2) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--at');
  console.log(at > 0 ? stampedAt(REPO, process.argv[at + 1]) : forBuild());
}
