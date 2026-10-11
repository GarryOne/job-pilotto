// npm run row -- "<pool row name or case folder>" [--old <extension dir>]: one pool row replayed offline on the app's own path (lib/row-replay.mjs): seconds, the
// page-kind asks (and how many the row's kept answers did not cover), the live presses it followed (or where it pressed otherwise), any address the run never
// recorded, and the evidence lines a live run prints. npm run rows [--old <dir>]: every row of the newest day, one after another in one browser, one line each.
// Rows come from the pool's candidates (SMOKE_CANDIDATES, default <QA folder>/replay-candidates). Runs under the heavy lock (package.json). Nothing reaches a site.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {findRow, replayRow, replayRows} from './lib/row-replay.mjs';

const args = process.argv.slice(2), at = args.indexOf('--old'), all = args.includes('--all');
const extensionDir = at >= 0 ? path.resolve(args[at + 1]) : undefined, name = args.filter((arg, i) => !(at >= 0 && (i === at || i === at + 1)) && arg !== '--all').join(' ');
const root = process.env.SMOKE_CANDIDATES || path.join(os.homedir(), 'Library/Application Support/Job Pilotto QA', 'replay-candidates');
const line = r => (r.error ? `row: ${r.row}: ERROR ${r.error}` : `row: ${r.row}: ${r.seconds} s, ${r.asks} asks (${r.misses} not in its kept answers), followed ${r.followed}/${r.livePresses} live presses${r.divergence ? `, DIVERGED: ${r.divergence}` : ''}${r.unrecorded.length ? `, ${r.unrecorded.length} addresses not recorded` : ''}`);

if (all) {
  const day = (() => { try { return fs.readdirSync(root).filter(d => /^\d{4}-\d\d-\d\d$/.test(d)).sort().at(-1); } catch { return ''; } })();
  const dirs = day ? fs.readdirSync(path.join(root, day)).map(d => path.join(root, day, d)).filter(d => fs.existsSync(path.join(d, 'case.json'))) : [];
  if (!dirs.length) { console.error(`rows: no candidates in ${root}`); process.exit(2); }
  const started = Date.now(), results = await replayRows(dirs, {extensionDir});
  for (const r of results) console.log(line(r));
  console.log(`rows: ${results.length} rows of ${day} in ${Math.round((Date.now() - started) / 1000)} s; ${results.filter(r => !r.error && !r.divergence).length} followed the live run to its end`);
} else {
  const dir = name && findRow(name, root);
  if (!dir) { console.error(`row: no candidate for "${name}" in ${root} (give a pool row's name or a case folder)`); process.exit(2); }
  const result = await replayRow(dir, {extensionDir, say: console.log});
  console.log(line(result));
  for (const address of result.unrecorded) console.log(`row: route not recorded: ${address}`);
  for (const [part, lines] of Object.entries(result.evidence)) console.log(`${part}:\n${lines.length ? lines.map(text => `  ${text}`).join('\n') : '  (none in the app log)'}`);
}
