// npm run row-to-case -- "<pool row name or capture folder>" <case-name> --old <extension folder of the build before the fix> [--ask-cold]
// A failing pool row's capture becomes a case in e2e/recorded/ that the CI recorded-pages job replays (lib/row-to-case.mjs has the proof and the exit codes: 0 written, 1, 2, 3 old build passes, 4 not provable).
// The row comes from the pool's candidates (SMOKE_CANDIDATES, default <QA folder>/replay-candidates); a capture from before the replay format is STALE and is refused. Runs under the heavy lock (package.json).
import os from 'node:os';
import path from 'node:path';
import {REPLAY_DIR} from './lib/page-replay.mjs';
import {findRow, staleCapture} from './lib/row-replay.mjs';
import {rowToCase} from './lib/row-to-case.mjs';

const args = process.argv.slice(2), at = args.indexOf('--old'), askCold = args.includes('--ask-cold');
const oldDir = at >= 0 ? path.resolve(args[at + 1] || '') : process.env.OLD_EXTENSION_DIR ? path.resolve(process.env.OLD_EXTENSION_DIR) : '';
const rest = args.filter((arg, i) => !(at >= 0 && (i === at || i === at + 1)) && arg !== '--ask-cold'), name = rest.pop(), row = rest.join(' ');
const root = process.env.SMOKE_CANDIDATES || path.join(os.homedir(), 'Library/Application Support/Job Pilotto QA', 'replay-candidates');
if (!row || !name) { console.error('row-to-case: usage: npm run row-to-case -- "<row>" <case-name> --old <extension folder> [--ask-cold]'); process.exit(2); }
const dir = findRow(row, root);
if (!dir) { console.error(`row-to-case: no candidate for "${row}" in ${root}`); process.exit(2); }
const stale = staleCapture(dir);
if (stale) { console.error(`row-to-case: ${path.basename(dir)}: ${stale}`); process.exit(2); }
const {code, lines} = await rowToCase({rowDir: dir, name, outDir: REPLAY_DIR, oldDir, askCold});
for (const line of lines) console.log(line);
process.exit(code);
