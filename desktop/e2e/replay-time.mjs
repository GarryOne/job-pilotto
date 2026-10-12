// CI's report job of .github/workflows/recorded-pages.yml, on a pull request: the PR's fill time per recorded case against main's last replays (lib/replay-time.mjs).
// Fails (exit 1) when the median slowdown is SLOWER_SECONDS or more; no baseline or too few cases in both: it says so and passes.
// Run: node replay-time.mjs --pr <results.json>... --main <results.json>...
import fs from 'node:fs';
import {compareFill, SLOWER_SECONDS} from './lib/replay-time.mjs';

const args = process.argv.slice(2), split = args.indexOf('--main');
const read = files => files.filter(file => fs.existsSync(file)).flatMap(file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } });
const pr = read(args.slice(args.indexOf('--pr') + 1, split < 0 ? undefined : split)), main = split < 0 ? [] : read(args.slice(split + 1));
const result = compareFill(pr, main);
if (result.why) console.log(`fill time: not judged: ${result.why}`);
else {
  console.log(`fill time: median ${result.median >= 0 ? '+' : ''}${result.median} s per case vs main over ${result.cases} cases (fails at +${SLOWER_SECONDS} s)`);
  for (const one of result.worst) console.log(`  ${one.name}: ${one.main} s -> ${one.pr} s (${one.delta >= 0 ? '+' : ''}${one.delta})`);
  if (result.slower) { console.log(`fill time: SLOWER by a median ${result.median} s`); process.exitCode = 1; }
}
