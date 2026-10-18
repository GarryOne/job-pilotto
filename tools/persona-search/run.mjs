// The persona search check: a fictional new user through the app's own path, CV -> strategy draft -> first "Find jobs" -> more presses, with the
// numbers after each press (spec docs/superpowers/specs/2026-10-18-search-learns-sources.md; owner, 18 Oct 2026: finance in Amsterdam, music in
// Berlin, a driver in Nuremberg, and the SRE control). By hand only: it reads live public job sites (never past a login wall), and its AI runs
// on this Mac's Claude Code plan ($0), never an API key. Its folder is <os temp>/jp-persona-<name>[-<tag>]: never the person's app folder,
// Keychain, Notion or Telegram; telemetry and pool sharing are off.
//   python3 tools/persona-search/personas.py <out>            (the CVs: <out>/<name>/cv.pdf)
//   node tools/persona-search/run.mjs <name> <out> [--presses 5] [--tag before] [--fresh] [--draft <draft.json>]
//        [--tape <folder> --record | --replay [--speed 1]]
// Writes <out>/<name>/draft.json, run-<press>.log and presses.jsonl (one JSON line per press: tools/persona-search/metrics.py + time).
// --draft: the strategy from an earlier run (no AI), so two runs search for the same thing. --tape (src/search_tape.py, change 0 of the search
// plan): --record keeps every web and AI answer of the search; --replay serves them offline after their recorded time (x --speed), so a change
// is measured on the same sources: nothing leaves the computer, and an AI question the tape lacks goes to the plan and is added.
// tools/persona-search/ttfr.py <run-1.log> <data dir>: the seconds to the 1st and 10th relevant job and to the first 70+.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const [name, outArg] = process.argv.slice(2);
const option = (flag, fallback) => { const at = process.argv.indexOf(flag); return at > 0 ? process.argv[at + 1] : fallback; };
if (!name || !outArg) { console.error('usage: node tools/persona-search/run.mjs <name> <out> [--presses 5] [--tag t] [--fresh]'); process.exit(2); }
const out = path.resolve(outArg, name), presses = Number(option('--presses', 5)), tag = option('--tag', '');
const dir = path.join(os.tmpdir(), `jp-persona-${name}${tag ? `-${tag}` : ''}`);
if (process.argv.includes('--fresh')) fs.rmSync(dir, {recursive: true, force: true});
fs.mkdirSync(dir, {recursive: true});
fs.copyFileSync(path.join(out, 'cv.pdf'), path.join(dir, 'cv.pdf'));
const tape = option('--tape', '');
if (tape) {   // read by the engine (desktop/lib/pipeline-env.js passes these three on)
  if (process.argv.includes('--record') === process.argv.includes('--replay')) { console.error('--tape needs --record or --replay'); process.exit(2); }
  Object.assign(process.env, {JOB_PILOTTO_SEARCH_TAPE: path.resolve(tape), JOB_PILOTTO_SEARCH_TAPE_MODE: process.argv.includes('--record') ? 'record' : 'replay',
    JOB_PILOTTO_TAPE_SPEED: option('--speed', '1')});
}

const lib = file => import(path.join(ROOT, 'desktop', 'lib', file));
const {createStorage} = await lib('storage.js');
const {ensureConfig, python} = await lib('pipeline-env.js');
const {searchSteps} = await lib('search-steps.js');
const strategy = await lib('strategy.js');
const claudeCode = await lib('claude-code.js');
const {realClaude} = await import(path.join(ROOT, 'desktop', 'e2e', 'lib', 'real-claude.mjs'));
const storage = createStorage(dir, {encrypt: value => value, decrypt: value => value});   // its own folder: nothing reaches the Keychain
ensureConfig(storage);
storage.saveSettings({aiEngine: 'cli', claudeCode: {path: realClaude()}, store: 'sqlite', telemetry: false, shareEmployers: false});

const metrics = (script = 'metrics.py', ...args) => JSON.parse(execFileSync(python(), [path.join(ROOT, 'tools', 'persona-search', script), ...args], {cwd: ROOT, env: {
  ...process.env, PYTHONPATH: ROOT, JOB_PILOTTO_NO_DOTENV: '1', JOB_PILOTTO_FOLLOW_APP: '0',
  JOB_PILOTTO_CONFIG_DIR: storage.path('config'), JOB_PILOTTO_DATA_DIR: storage.path('data')}}).toString().trim().split('\n').pop());

if (!storage.settings().setupDone) {   // the wizard's strategy step: the app's own draft from the CV, kept as the review's "Save" does without Notion
  const started = Date.now(), kept = option('--draft', '');
  const draft = kept ? JSON.parse(fs.readFileSync(kept, 'utf8')) : await strategy.draft(storage, {}, '', claudeCode.client(storage));
  if (!kept || path.resolve(kept) !== path.join(out, 'draft.json')) fs.writeFileSync(path.join(out, 'draft.json'), JSON.stringify(draft, null, 2));
  strategy.keepLocally(storage, draft);
  storage.saveSettings({setupDone: true, cvName: 'cv.pdf'});
  console.log(`${name}: strategy ${kept ? `from ${kept}` : 'drafted'} in ${Math.round((Date.now() - started) / 1000)} s`);
}
const failed = [];
const done = fs.existsSync(path.join(out, 'presses.jsonl')) ? fs.readFileSync(path.join(out, 'presses.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length : 0;
for (let press = done + 1; press <= presses; press++) {
  const started = Date.now(), log = fs.createWriteStream(path.join(out, `run-${press}.log`));
  const {code} = await searchSteps(storage, line => log.write(`[${Math.round((Date.now() - started) / 1000)}s] ${line}\n`), 'run', press === 1 ? 'first' : 'you');
  log.end();
  const crashes = metrics('crashes.py', path.join(out, `run-${press}.log`));   // a Traceback in the log: a step died, its numbers are thin
  const row = {press, code, crashes, seconds: Math.round((Date.now() - started) / 1000), ...metrics(),
    ...(press === 1 ? {ttfr: metrics('ttfr.py', path.join(out, 'run-1.log'))} : {})};
  fs.appendFileSync(path.join(out, 'presses.jsonl'), `${JSON.stringify(row)}\n`);
  const first = row.ttfr ? `; 1st/10th relevant at ${row.ttfr.first_in_places_s ?? '—'}/${row.ttfr.tenth_in_places_s ?? '—'} s, 1st 70+ at ${row.ttfr.first_fit70_s ?? '—'} s` : '';
  if (crashes.length) { failed.push(...crashes); console.log(`PRESS ${name} ${press} FAILED: ${crashes.map(crash => `${crash.step}: ${crash.error}`).join(' | ')}`); }
  console.log(`PRESS ${name} ${press}: ${row.in_places} in places, ${row.scored_in_places} scored, ${row.fit70_in_places} fit 70+ (${row.seconds} s${first})`);
}
if (failed.length) { console.log(`PERSONA FAILED ${name}: ${failed.length} crash(es), the numbers above are not a clean run`); process.exitCode = 1; }
else console.log(`PERSONA DONE ${name}`);
