// npm run row -- "<pool row name or case folder>" [--old <extension dir>]: one pool row replayed offline on the app's own path (lib/row-replay.mjs): seconds, the
// page-kind asks (and how many the row's kept answers did not cover), the live presses it followed (or where it pressed otherwise), any address the run never
// recorded, and the evidence lines a live run prints. npm run rows [--old <dir>]: every row of the newest day, one after another in one browser, one line each.
// Rows come from the pool's candidates (SMOKE_CANDIDATES, default <QA folder>/replay-candidates). Runs under the heavy lock (package.json). Nothing reaches a site.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {askDiff} from './lib/ask-diff.mjs';
import {seedNote} from './lib/applicant-seed.mjs';
import {looseSummary} from './lib/row-case-run.mjs';
import {findRow, replayRow, replayRows, staleCapture} from './lib/row-replay.mjs';

const args = process.argv.slice(2), at = args.indexOf('--old'), all = args.includes('--all'), loose = args.includes('--loose');   // --loose: as CI replays a row case (a changed system prompt is a counted warning)
const extensionDir = at >= 0 ? path.resolve(args[at + 1]) : undefined, name = args.filter((arg, i) => !(at >= 0 && (i === at || i === at + 1)) && arg !== '--all' && arg !== '--loose').join(' ');
const root = process.env.SMOKE_CANDIDATES || path.join(os.homedir(), 'Library/Application Support/Job Pilotto QA', 'replay-candidates');
const line = r => (r.error ? `row: ${r.row}: ERROR ${r.error}` : `row: ${r.row}: ${r.seconds} s${r.endedBy ? ` (ended: ${r.endedBy})` : ''}, ${r.asks} asks (${r.misses} not in its kept answers${r.missParts?.length ? `; the nearest kept ask differs in ${r.missParts.join(', ')}` : ''}${r.missVolatile?.length ? `; a clock time or date in ${r.missVolatile.join(', ')} can never match` : ''}), followed ${r.followed}/${r.livePresses} live presses${r.divergence ? `, DIVERGED: ${r.divergence}` : ''}${r.unrecorded.length ? `, ${r.unrecorded.length} addresses not recorded` : ''}`);

if (all) {
  const day = (() => { try { return fs.readdirSync(root).filter(d => /^\d{4}-\d\d-\d\d$/.test(d)).sort().at(-1); } catch { return ''; } })();
  const dirs = day ? fs.readdirSync(path.join(root, day)).map(d => path.join(root, day, d)).filter(d => fs.existsSync(path.join(d, 'case.json'))) : [];
  if (!dirs.length) { console.error(`rows: no candidates in ${root}`); process.exit(2); }
  const stale = dirs.filter(dir => staleCapture(dir));
  for (const dir of stale) console.log(`row: ${path.basename(dir)}: STALE: ${staleCapture(dir)}`);
  if (stale.length === dirs.length) process.exit(3);
  for (const dir of dirs.filter(one => !stale.includes(one) && seedNote(one))) console.log(`row: ${path.basename(dir)}: ${seedNote(dir)}`);   // lib/applicant-seed.mjs
  const started = Date.now(), results = await replayRows(dirs.filter(dir => !stale.includes(dir)), {extensionDir});
  for (const r of results) { console.log(line(r)); if (!r.error) console.log(r.endShot?.file ? `row: ${r.row}: end screenshot: ${r.endShot.file}` : `row: ${r.row}: no end screenshot: ${r.endShot?.why || 'the replay gave none'}`); }
  console.log(`rows: ${results.length} rows of ${day} in ${Math.round((Date.now() - started) / 1000)} s; ${results.filter(r => !r.error && !r.divergence).length} followed the live run to its end`);
} else {
  const dir = name && findRow(name, root);
  if (!dir) { console.error(`row: no candidate for "${name}" in ${root} (give a pool row's name or a case folder)`); process.exit(2); }
  const stale = staleCapture(dir);
  if (stale) { console.error(`row: ${path.basename(dir)}: ${stale}`); process.exit(3); }
  if (!loose && seedNote(dir)) console.log(`row: ${path.basename(dir)}: ${seedNote(dir)}`);   // its fill asks miss the kept answers (lib/applicant-seed.mjs)
  const result = await replayRow(dir, {extensionDir, loose, say: console.log});
  console.log(line(result));
  console.log(result.endShot?.file ? `row: end screenshot: ${result.endShot.file}` : `row: no end screenshot: ${result.endShot?.why || 'the replay gave none'}`);   // the replay's last picture, to set beside the live end.png (lib/end-shot.mjs)
  if (loose) console.log(`row: ${looseSummary(result.looseHits) || 'no loose memo hit: every ask matched its kept answer exactly'}`);
  if (result.misses) {   // the live run's own asks (the app's capture) against what the replayed extension sent: what the kept answer was asked about, line by line
    let calls = []; try { calls = JSON.parse(fs.readFileSync(path.join(dir, 'ai-calls.json'), 'utf8')); } catch { /* a capture without it */ }
    for (const text of askDiff(calls, result.requests)) console.log(`row: ask differs: ${text}`);
  }
  for (const address of result.unrecorded) console.log(`row: route not recorded: ${address}`);
  for (const [part, lines] of Object.entries(result.evidence)) console.log(`${part}:\n${lines.length ? lines.map(text => `  ${text}`).join('\n') : '  (none in the app log)'}`);
}
