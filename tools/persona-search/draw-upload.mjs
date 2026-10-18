// Sends the daily draw's first press to /admin/lab-job-search "Random draws" (owner, 18 Oct 2026; .github/workflows/random-draw.yml). Counts, seconds and the build sha only.
//   REPLAYS_PUBLISH_KEY=... node tools/persona-search/draw-upload.mjs <out> [--build <sha>] [--branch main] [--dry]
// <out> is run.mjs's output folder for the name "draw" (<out>/draw/presses.jsonl, draw.json from draw.py). The site refuses any branch but main.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {rowFromDraw} from '../../site/src/search-lab-draws.js';

const option = (flag, fallback) => { const at = process.argv.indexOf(flag); return at > 0 ? process.argv[at + 1] : fallback; };
const out = process.argv[2];
if (!out || out.startsWith('--')) { console.error('usage: REPLAYS_PUBLISH_KEY=... node tools/persona-search/draw-upload.mjs <out> [--build <sha>] [--branch main] [--dry]'); process.exit(2); }
const build = option('--build', execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim()), branch = option('--branch', 'main');
const folder = path.join(out, 'draw'), presses = path.join(folder, 'presses.jsonl');
if (!fs.existsSync(presses)) { console.error(`no presses.jsonl under ${folder}`); process.exit(1); }
const row = rowFromDraw(JSON.parse(fs.readFileSync(path.join(folder, 'draw.json'), 'utf8')), JSON.parse(fs.readFileSync(presses, 'utf8').split('\n').filter(Boolean)[0]), {build});
if (process.argv.includes('--dry')) { console.log(JSON.stringify({branch, draw: row}, null, 2)); process.exit(0); }
if (!process.env.REPLAYS_PUBLISH_KEY) { console.error('REPLAYS_PUBLISH_KEY is not set'); process.exit(2); }
const answer = await fetch('https://www.jobpilotto.top/search-lab/draws', {method: 'PUT', headers: {Authorization: `Bearer ${process.env.REPLAYS_PUBLISH_KEY}`, 'Content-Type': 'application/json'}, body: JSON.stringify({branch, draw: row})});
console.log(`${answer.status} ${await answer.text()}`);
process.exitCode = answer.ok ? 0 : 1;
