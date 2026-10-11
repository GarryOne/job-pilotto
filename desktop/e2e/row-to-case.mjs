// npm run row-to-case -- "<pool row name or capture folder>" <case-name> --old <extension folder of the build before the fix> [--ask-cold] [--fixed]
// --old-commit <sha>: instead of --old, build the old extension from this checkout with that commit's extension changes taken out, into a temp folder (lib/old-extension.mjs).
// --fixed: the capture was taken on a build that already has the fix (a regression case): expect = the live run itself, and the old build must fail it.
// A failing pool row's capture becomes a case in e2e/recorded/ that the CI recorded-pages job replays (lib/row-to-case.mjs has the proof and the exit codes: 0 written, 1, 2, 3 old build passes, 4 not provable).
// The row comes from the pool's candidates (SMOKE_CANDIDATES, default <QA folder>/replay-candidates); a capture from before the replay format is STALE and is refused. Runs under the heavy lock (package.json).
import os from 'node:os';
import path from 'node:path';
import {REPLAY_DIR} from './lib/page-replay.mjs';
import {seedNote} from './lib/applicant-seed.mjs';
import {findRow, staleCapture} from './lib/row-replay.mjs';
import {oldExtension} from './lib/old-extension.mjs';
import {rowToCase} from './lib/row-to-case.mjs';

const args = process.argv.slice(2), at = args.indexOf('--old'), commitAt = args.indexOf('--old-commit'), askCold = args.includes('--ask-cold'), fixed = args.includes('--fixed');
let oldDir = at >= 0 ? path.resolve(args[at + 1] || '') : process.env.OLD_EXTENSION_DIR ? path.resolve(process.env.OLD_EXTENSION_DIR) : '';
const rest = args.filter((arg, i) => !(at >= 0 && (i === at || i === at + 1)) && !(commitAt >= 0 && (i === commitAt || i === commitAt + 1)) && arg !== '--ask-cold' && arg !== '--fixed'), name = rest.pop(), row = rest.join(' ');
const root = process.env.SMOKE_CANDIDATES || path.join(os.homedir(), 'Library/Application Support/Job Pilotto QA', 'replay-candidates');
if (!row || !name) { console.error('row-to-case: usage: npm run row-to-case -- "<row>" <case-name> --old <extension folder> [--ask-cold] [--fixed]  (or --old-commit <sha> in place of --old)'); process.exit(2); }
const dir = findRow(row, root);
if (!dir) { console.error(`row-to-case: no candidate for "${row}" in ${root}`); process.exit(2); }
const stale = staleCapture(dir);
if (stale) { console.error(`row-to-case: ${path.basename(dir)}: ${stale}`); process.exit(2); }
const thin = seedNote(dir);   // a capture made with another applicant seed (or before the seed was recorded): its fill asks miss
if (thin) { console.error(`row-to-case: ${path.basename(dir)}: ${thin}`); process.exit(2); }
let built = null;
if (commitAt >= 0 && !oldDir) {
  try { built = oldExtension({sha: args[commitAt + 1]}); oldDir = built.extensionDir; } catch (error) { console.error(`row-to-case: ${error.message}`); process.exit(2); }
  console.error(built.note ? `row-to-case: ${built.note}` : `row-to-case: old extension = this checkout minus ${args[commitAt + 1]}, in ${built.extensionDir}`);
}
const {code, lines} = await rowToCase({rowDir: dir, name, outDir: REPLAY_DIR, oldDir, askCold, fixed, say: line => console.error(`${new Date().toTimeString().slice(0, 8)} ${line}`)});
built?.remove();
for (const line of lines) console.log(line);
process.exit(code);
