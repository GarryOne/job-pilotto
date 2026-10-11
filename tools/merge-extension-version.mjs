// A git merge driver for extension/manifest.json (tools/ship.sh registers it; .gitattributes names it): a rebase over a main that moved the extension version
// no longer conflicts on the "version" line. Three-way merge with the version taken out of all three sides, the upstream's version put back; ship.sh then
// takes the next free version once, under the landing lock (tools/extension-version-bump.mjs). Any other conflict in the file stays a conflict (exit 1).
//   merge driver: node tools/merge-extension-version.mjs %O %A %B     (writes the result to %A)
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';

const VERSION = /("version"\s*:\s*")[^"]*(")/;
const [, , basePath, oursPath, theirsPath] = process.argv;
if (basePath) {
  const ours = fs.readFileSync(oursPath, 'utf8');
  for (const file of [basePath, oursPath, theirsPath]) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(VERSION, '$1VERSION$2'));
  try { execFileSync('git', ['merge-file', oursPath, basePath, theirsPath], {stdio: 'ignore'}); } catch { process.exit(1); }
  fs.writeFileSync(oursPath, fs.readFileSync(oursPath, 'utf8').replace(VERSION, `$1${ours.match(VERSION)[0].match(/"version"\s*:\s*"([^"]*)"/)[1]}$2`));
}
