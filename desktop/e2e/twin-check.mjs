// npm run twin-check [-- --yes] [--seconds 150] [--only Ashby|Lever] [--allow-branch]: the post-merge live check. One real application form per platform people use most
// (lib/twin-check.mjs PLATFORMS), each run HELD through `npm run live` (the real extension of THIS checkout on the real site, the grown fake applicant, the privacy tripwire, the per-site
// daily limit, never Submit, no account button), then one table: reached, filled/left, fill errors, refused presses, the drop vs that row's last check, the panel picture.
// Without --yes it only prints the one-line ask (what, how long, what it costs) and exits: the owner's yes, in the session's window, is the --yes. Exit 1 on any red row.
// Reports: <QA folder>/twin-checks/<time>-<sha>.json and the pictures beside it (outside the repo: they name real postings).
import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseLive} from './lib/record-sites.mjs';
import {runFinished} from './lib/evidence-bundle.mjs';
import {PLATFORMS, checkOf, pickRows, tableOf, verdictOf} from './lib/twin-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const QA_DIR = path.join(os.homedir(), 'Library/Application Support/Job Pilotto QA');
const OUT = process.env.TWIN_CHECK_DIR || path.join(QA_DIR, 'twin-checks');
const args = process.argv.slice(2), flag = name => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : ''; };
const git = (...a) => execFileSync('git', a, {cwd: here, encoding: 'utf8'}).trim();

const seconds = Number(flag('seconds')) || 150, only = flag('only');
const shapes = JSON.parse(fs.readFileSync(path.join(here, 'smoke-sites.json'), 'utf8')).shapes;
const rows = pickRows(shapes, PLATFORMS.filter(item => !only || only.split('|').some(word => item.name.toLowerCase() === word.trim().toLowerCase()))).filter(item => item.url);
if (!rows.length) { console.error('twin-check: no pool row for the platforms asked'); process.exit(2); }

try { git('fetch', '-q', 'origin', 'main'); } catch { /* offline: compare with what we have */ }
const sha = git('rev-parse', '--short=9', 'HEAD'), main = git('rev-parse', '--short=9', 'origin/main');
if (sha !== main && !args.includes('--allow-branch')) { console.error(`twin-check: this checkout is ${sha}, main is ${main}: run it from a worktree at origin/main (or --allow-branch to check a branch)`); process.exit(2); }
const minutes = Math.ceil(rows.length * (seconds + 60) / 60);
console.log(`twin-check: run the post-merge check on main ${sha}: ${rows.length} forms (${rows.map(item => item.platform).join(', ')}), ~${minutes} min, $0 (the plan's claude -p; ~$0.06 a row on the API key). HELD: never Submit, no account button, no captcha/login/SMS, the owner's window and data untouched.`);
if (!args.includes('--yes')) { console.log('twin-check: not started (add --yes once the owner has said yes)'); process.exit(0); }

const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const lastCheck = platform => {   // the newest earlier report that has this platform, same applicant
  const files = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter(name => /\.json$/.test(name)).sort().reverse() : [];
  for (const name of files) { const found = read(path.join(OUT, name))?.rows?.find(item => item.platform === platform && item.check && item.check.applicant === 'grown'); if (found) return found.check; }
  return null;
};

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19), runDir = path.join(OUT, `${stamp}-${sha}`);
fs.mkdirSync(runDir, {recursive: true});
const runRow = (row, captureDir) => new Promise(resolve => {
  const child = spawn('bash', [path.join(here, 'live.sh'), row.url, '--title', row.shape, '--seconds', String(seconds), '--capture', captureDir, '--no-library'], {cwd: here, env: {...process.env, JP_APPLICANT: 'grown'}});
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; process.stdout.write(`  ${row.platform}: ${chunk}`.replace(/\n(?!$)/g, `\n  ${row.platform}: `)); });
  child.stderr.on('data', chunk => { output += chunk; process.stderr.write(chunk); });
  child.on('close', (code, signal) => resolve({output, code, signal}));
});

const table = [];
for (const row of rows) {
  const captureDir = path.join(runDir, row.platform.toLowerCase());
  console.log(`twin-check: ${row.platform}: ${row.url} (HELD, ~${seconds}s)`);
  const run = await runRow(row, captureDir);
  if (run.code === 3) { table.push({platform: row.platform, skipped: 'the site rests today (per-site limit or a block)'}); console.log(`twin-check: ${row.platform}: skipped (site limit)`); continue; }
  if (!runFinished(run)) { table.push({platform: row.platform, check: {...checkOf({row, result: {reached: 'none', errors: [`the run did not finish (exit ${run.code}${run.signal ? `, ${run.signal}` : ''})`]}}), applicant: 'grown'}, verdict: {red: true, why: ['the run did not finish']}}); continue; }
  const result = parseLive(run.output);   // its `tripped` is a hit that names a field ("typed into"), not the startup line
  const check = {...checkOf({row, result, appLog: fs.existsSync(path.join(captureDir, 'app.log')) ? fs.readFileSync(path.join(captureDir, 'app.log'), 'utf8') : '',
    consoleLog: fs.existsSync(path.join(captureDir, 'extension-console.log')) ? fs.readFileSync(path.join(captureDir, 'extension-console.log'), 'utf8') : '',
    panel: fs.existsSync(path.join(captureDir, 'end.png')) ? path.join(captureDir, 'end.png') : ''}), applicant: 'grown'};
  const last = lastCheck(row.platform);
  table.push({platform: row.platform, check, last: last ? {reached: last.reached, filled: last.filled} : null, verdict: verdictOf(check, last)});
  console.log(`twin-check: ${row.platform}: ${check.reached}${check.filled != null ? `, ${check.filled} filled, ${check.left} left` : ''}${table.at(-1).verdict.red ? ` RED: ${table.at(-1).verdict.why.join('; ')}` : ''}`);
}
const text = tableOf(table, {sha});
fs.writeFileSync(path.join(runDir, 'table.md'), text);
fs.writeFileSync(`${runDir}.json`, `${JSON.stringify({sha, day: stamp, rows: table}, null, 1)}\n`);
console.log(`\n${text}\ntwin-check: report ${runDir}.json; table and panel pictures in ${runDir}`);
process.exit(table.some(item => item.verdict?.red) ? 1 : 0);
