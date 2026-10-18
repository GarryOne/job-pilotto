// Sends the persona harness's first press of each candidate to /admin/lab-job-search (owner, 18 Oct 2026; PR 1 of the Job Search lab, by hand until the CI replay exists).
//   REPLAYS_PUBLISH_KEY=... node tools/persona-search/lab-upload.mjs <out> [--build <sha>] [--branch main] [--dry]
// <out> is run.mjs's output folder (<out>/<name>/presses.jsonl). Counts, seconds and the build sha only; the site refuses any branch but main, so a hand upload says --branch main only for main's build.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {rowFromPress} from '../../site/src/search-lab-store.js';

const CANDIDATES = {finance: 'Finance · Amsterdam', music: 'Music producer · Berlin', driver: 'CE driver · Nuremberg', sre: 'SRE (control) · Zurich',
  cluj: 'Software engineer · Cluj', chisinau: 'Software engineer · Chisinau'};
const URL_ROWS = 'https://www.jobpilotto.top/search-lab/rows';
const option = (flag, fallback) => { const at = process.argv.indexOf(flag); return at > 0 ? process.argv[at + 1] : fallback; };
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();

const out = process.argv[2];
if (!out || out.startsWith('--')) { console.error('usage: REPLAYS_PUBLISH_KEY=... node tools/persona-search/lab-upload.mjs <out> [--build <sha>] [--branch main] [--dry]'); process.exit(2); }
const build = option('--build', git('rev-parse', 'HEAD')), branch = option('--branch', git('branch', '--show-current'));
const rows = [];
for (const [name, label] of Object.entries(CANDIDATES)) {
  const file = path.join(out, name, 'presses.jsonl');
  if (!fs.existsSync(file)) continue;
  const press = JSON.parse(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)[0]);
  rows.push(rowFromPress(name, press, {label, control: name === 'sre', build, runAt: fs.statSync(file).mtime.toISOString()}));
}
if (!rows.length) { console.error(`no presses.jsonl under ${out}`); process.exit(1); }
if (process.argv.includes('--dry')) { console.log(JSON.stringify({branch, rows}, null, 2)); process.exit(0); }
if (!process.env.REPLAYS_PUBLISH_KEY) { console.error('REPLAYS_PUBLISH_KEY is not set'); process.exit(2); }
const answer = await fetch(URL_ROWS, {method: 'PUT', headers: {Authorization: `Bearer ${process.env.REPLAYS_PUBLISH_KEY}`, 'Content-Type': 'application/json'}, body: JSON.stringify({branch, rows})});
console.log(`${answer.status} ${await answer.text()}`);
process.exitCode = answer.ok ? 0 : 1;
