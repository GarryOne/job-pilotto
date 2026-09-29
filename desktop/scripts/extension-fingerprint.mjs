// The Chrome extension's fingerprint (extension/fingerprint.json): a hash of its files, with the version it shipped as.
// Chrome reloads the extension only when the app's copy has a higher version, so changed files without a new version
// never reached the browser (29 Sep 2026: "0 filled" from an old review.js). desktop/test/extension-version.test.js
// fails until the version is raised; then `node desktop/scripts/extension-fingerprint.mjs --write` records it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../extension');
const FILE = path.join(DIR, 'fingerprint.json');
const SKIP = new Set(['fingerprint.json', 'README.md', 'sync.sh']);

export const manifestVersion = () => JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')).version;
export const recorded = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));

export function hash(dir = DIR) {
  const sha = crypto.createHash('sha256');
  const walk = sub => {
    for (const name of fs.readdirSync(path.join(dir, sub)).sort()) {
      const rel = path.join(sub, name);
      if (fs.statSync(path.join(dir, rel)).isDirectory()) { walk(rel); continue; }
      if (SKIP.has(rel) || name.startsWith('.')) continue;  // hidden files (Finder's .DS_Store) aren't the extension
      let body = fs.readFileSync(path.join(dir, rel));
      if (rel === 'manifest.json') body = Buffer.from(JSON.stringify({...JSON.parse(body), version: ''}));
      // The same on every system: "/" in paths, and text files with \n line endings (a Windows checkout has \r\n).
      if (/\.(js|json|html|css|md|txt)$/.test(name)) body = Buffer.from(body.toString('utf8').replace(/\r\n/g, '\n'));
      sha.update(rel.split(path.sep).join('/')).update('\0').update(body).update('\0');
    }
  };
  walk('');
  return sha.digest('hex').slice(0, 16);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const now = {version: manifestVersion(), hash: hash()};
  let before = null;
  try { before = recorded(); } catch {}
  if (before && before.hash !== now.hash && before.version === now.version) {
    console.error(`The extension changed but is still version ${now.version}: raise "version" in extension/manifest.json first.`);
    process.exit(1);
  }
  if (process.argv.includes('--write')) fs.writeFileSync(FILE, JSON.stringify(now, null, 2) + '\n');
  console.log(JSON.stringify(now));
}
