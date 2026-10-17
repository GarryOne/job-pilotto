// The persona search check: a fictional new user through the app's own path, CV -> strategy draft -> first "Find jobs" -> more presses, with the
// numbers after each press (spec docs/superpowers/specs/2026-10-18-search-learns-sources.md; owner, 18 Oct 2026: finance in Amsterdam, music in
// Berlin, a driver in Nuremberg, and the SRE control). By hand only: it reads live public job sites (never past a login wall), and its AI runs
// on this Mac's Claude Code plan ($0), never an API key. Its folder is <os temp>/jp-persona-<name>[-<tag>]: never the person's app folder,
// Keychain, Notion or Telegram; telemetry and pool sharing are off.
//   python3 tools/persona-search/personas.py <out>            (the CVs: <out>/<name>/cv.pdf)
//   node tools/persona-search/run.mjs <name> <out> [--presses 5] [--tag before] [--fresh]
// Writes <out>/<name>/draft.json, run-<press>.log and presses.jsonl (one JSON line per press: tools/persona-search/metrics.py + time).
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

const metrics = () => JSON.parse(execFileSync(python(), [path.join(ROOT, 'tools', 'persona-search', 'metrics.py')], {cwd: ROOT, env: {
  ...process.env, PYTHONPATH: ROOT, JOB_PILOTTO_NO_DOTENV: '1', JOB_PILOTTO_FOLLOW_APP: '0',
  JOB_PILOTTO_CONFIG_DIR: storage.path('config'), JOB_PILOTTO_DATA_DIR: storage.path('data')}}).toString().trim().split('\n').pop());

if (!storage.settings().setupDone) {   // the wizard's strategy step: the app's own draft from the CV, kept as the review's "Save" does without Notion
  const started = Date.now();
  const draft = await strategy.draft(storage, {}, '', claudeCode.client(storage));
  fs.writeFileSync(path.join(out, 'draft.json'), JSON.stringify(draft, null, 2));
  strategy.keepLocally(storage, draft);
  storage.saveSettings({setupDone: true, cvName: 'cv.pdf'});
  console.log(`${name}: strategy drafted in ${Math.round((Date.now() - started) / 1000)} s`);
}
const done = fs.existsSync(path.join(out, 'presses.jsonl')) ? fs.readFileSync(path.join(out, 'presses.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length : 0;
for (let press = done + 1; press <= presses; press++) {
  const started = Date.now(), log = fs.createWriteStream(path.join(out, `run-${press}.log`));
  const {code} = await searchSteps(storage, line => log.write(`[${Math.round((Date.now() - started) / 1000)}s] ${line}\n`), 'run', press === 1 ? 'first' : 'you');
  log.end();
  const row = {press, code, seconds: Math.round((Date.now() - started) / 1000), ...metrics()};
  fs.appendFileSync(path.join(out, 'presses.jsonl'), `${JSON.stringify(row)}\n`);
  console.log(`PRESS ${name} ${press}: ${row.in_places} in places, ${row.scored_in_places} scored, ${row.fit70_in_places} fit 70+ (${row.seconds} s)`);
}
console.log(`PERSONA DONE ${name}`);
