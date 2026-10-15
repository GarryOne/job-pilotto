// The version a development copy (Chrome loads the checkout's extension/ itself) is told to be at: the manifest's base plus the number of commits that changed extension/ (the same stamp a build gets, desktop/scripts/extension-stamp.mjs), so a pulled change reaches the running extension.
// Guarded by desktop/test/dev-extension-version.test.js.
import {execFileSync} from 'node:child_process';

const TTL_MS = 20000;   // the app asks on every check-in; a pull changes the count at most every couple of minutes
const cache = new Map();

// manifestVersion "0.9" or "0.9.12" -> "0.9.<commits>"; the manifest's own when git cannot count (no git, a shallow clone).
export function devVersion(repo, manifestVersion, {now = Date.now(), run = execFileSync} = {}) {
  const hit = cache.get(repo);
  if (hit && now - hit.at < TTL_MS && hit.manifest === manifestVersion) return hit.version;
  let version = manifestVersion;
  try {
    const git = (...args) => String(run('git', ['-C', repo, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000})).trim();
    const commits = git('rev-parse', '--is-shallow-repository') === 'true' ? 0 : Number(git('rev-list', '--count', 'HEAD', '--', 'extension'));
    if (Number.isInteger(commits) && commits > 0) version = `${String(manifestVersion).split('.').slice(0, 2).join('.')}.${commits}`;
  } catch { /* the manifest's version stands */ }
  cache.set(repo, {at: now, manifest: manifestVersion, version});
  return version;
}
