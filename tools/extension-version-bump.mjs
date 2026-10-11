// The extension version, taken at ship time (tools/ship.sh, after the rebase, under the landing lock): when the branch changed extension/, its manifest
// version becomes the next free one after the base's (never two sessions on the same number: 0.9.182 and 0.9.185 were each taken twice on 11 Oct 2026),
// and extension/fingerprint.json is written once from the base's copy. Prints one JSON line; the caller amends the two files into the last commit.
//   node tools/extension-version-bump.mjs --base origin/main [--check]     --check only says what it would do
// Same rule the desktop test enforces (desktop/test/extension-version.test.js, scripts/extension-fingerprint.mjs). Guarded by desktop/test/extension-version-bump.test.js.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['extension/fingerprint.json', 'extension/README.md', 'extension/sync.sh']);   // the fingerprint script's own list
const parse = version => version.split('.').map(Number);
export const newer = (a, b) => { const [x, y] = [parse(a), parse(b)]; for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
export const next = version => { const parts = parse(version); parts[parts.length - 1] += 1; return parts.join('.'); };
export const setVersion = (text, version) => text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);

export function plan({base, mine, changed}) {
  if (!changed.some(file => file.startsWith('extension/') && !SKIP.has(file))) return {action: 'none'};
  return newer(mine, base) ? {action: 'keep', version: mine} : {action: 'bump', version: next(base)};
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const at = process.argv.indexOf('--base'), base = at < 0 ? 'origin/main' : process.argv[at + 1];
  const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
  const root = git('rev-parse', '--show-toplevel');
  const changed = git('diff', '--name-only', `${base}...HEAD`, '--', 'extension').split('\n').filter(Boolean);
  const manifest = path.join(root, 'extension', 'manifest.json');
  const decided = plan({base: JSON.parse(git('show', `${base}:extension/manifest.json`)).version, mine: JSON.parse(fs.readFileSync(manifest, 'utf8')).version, changed});
  if (decided.action !== 'none' && !process.argv.includes('--check')) {
    fs.writeFileSync(manifest, setVersion(fs.readFileSync(manifest, 'utf8'), decided.version));
    git('checkout', base, '--', 'extension/fingerprint.json');
    execFileSync('node', ['desktop/scripts/extension-fingerprint.mjs', '--write'], {cwd: root, stdio: ['ignore', 'ignore', 'inherit']});
  }
  console.log(JSON.stringify(decided));
}
