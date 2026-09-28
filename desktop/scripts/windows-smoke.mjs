// Windows smoke test (CI, after the installer is built): installs Job Pilotto the way a user would, then checks
// the installed app, not the source tree.
//   node scripts/windows-smoke.mjs <installer.exe> <output folder>
// 1. Silent per-user install (%LOCALAPPDATA%\Programs\…).
// 2. The bundled Python starts and imports what the pipeline, transcription and the Credential Manager need;
//    a secret round-trips through the Credential Manager; the pipeline lists (no) jobs from an empty folder.
// 3. The installed app renders three screens (welcome, the wizard's extras with the Apply with Claude
//    checklist, the Jobs page) in smoke mode (JOB_PILOTTO_SMOKE); screenshots go to the output folder.
// Any failure exits non-zero, so the release isn't published with a Windows app that doesn't start.
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [installer, out] = process.argv.slice(2);
if (!installer || !out) throw new Error('usage: node scripts/windows-smoke.mjs <installer.exe> <output folder>');
fs.mkdirSync(out, {recursive: true});
const say = line => console.log(`• ${line}`);

execFileSync(path.resolve(installer), ['/S'], {stdio: 'inherit', timeout: 5 * 60 * 1000});
const programs = path.join(process.env.LOCALAPPDATA, 'Programs');
const dir = fs.readdirSync(programs).map(name => path.join(programs, name)).find(d => fs.existsSync(path.join(d, 'Job Pilotto.exe')));
if (!dir) throw new Error(`Job Pilotto.exe not found under ${programs} after the install`);
const exe = path.join(dir, 'Job Pilotto.exe');
const pilot = path.join(dir, 'resources', 'pilot');
const python = path.join(pilot, 'python', 'python.exe');
say(`installed: ${exe}`);

const py = (args, env = {}) => execFileSync(python, args, {cwd: pilot, encoding: 'utf8', timeout: 120000,
  env: {...process.env, PYTHONUTF8: '1', ...env}}).trim();
say(py(['-c', 'import anthropic, keyring, sqlite3, ssl, sherpa_onnx, av, numpy, sys; ' +
  "print('Python', sys.version.split()[0], 'anthropic', anthropic.__version__, 'keyring', keyring.__version__)"]));
say(py(['-c', "from src import secret_store as s; s.put('job-pilotto.smoke.test', 'ok', 'ci'); " +
  "v = s.get('job-pilotto.smoke.test', 'ci'); s.delete('job-pilotto.smoke.test', 'ci'); " +
  "assert v == 'ok', v; assert s.get('job-pilotto.smoke.test', 'ci') is None; print('Credential Manager round-trip ok')"]));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-smoke-data-'));
for (const sub of ['config', 'data']) fs.mkdirSync(path.join(data, sub), {recursive: true});
for (const name of fs.readdirSync(path.join(pilot, 'config')).filter(n => n.endsWith('.json'))) {
  fs.copyFileSync(path.join(pilot, 'config', name), path.join(data, 'config', name));
}
const jobs = py(['-m', 'src.desktop', 'jobs'], {JOB_PILOTTO_NO_DOTENV: '1', JOB_PILOTTO_CONFIG_DIR: path.join(data, 'config'),
  JOB_PILOTTO_DATA_DIR: path.join(data, 'data')}).split(/\r?\n/).pop();
JSON.parse(jobs);
say(`pipeline jobs list ok: ${jobs.slice(0, 80)}`);

// The app's own screens. Fresh data folders each time; the Jobs page gets a finished setup (fake Notion ids,
// no search due), so it loads the list through the bundled Python like a real start.
const extras = `(() => { document.querySelectorAll('.step').forEach(s => { s.hidden = s.dataset.step !== 'extras'; }); })()`;
const waitForJobs = `new Promise(resolve => setTimeout(resolve, 8000))`;
const DONE = {setupDone: true, autoSearch: false, lastSearchAt: '2099-01-01T00:00:00.000Z',
  notionIds: {NOTION_APPLICATIONS_DB: 'smoke', NOTION_MATCHES_DB: 'smoke', NOTION_PROFILE_PAGE_ID: 'smoke', NOTION_ANSWERS_PAGE_ID: 'smoke'}};
for (const [name, js, settings] of [['welcome', '', null], ['wizard-extras', extras, null], ['jobs', waitForJobs, DONE]]) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-smoke-'));
  if (settings) fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(settings));
  const png = path.join(out, `windows-${name}.png`);
  const result = spawnSync(exe, [], {timeout: 90000, stdio: 'inherit',
    env: {...process.env, JOB_PILOTTO_USER_DATA: userData, JOB_PILOTTO_SMOKE: png, JOB_PILOTTO_SMOKE_JS: js}});
  if (!fs.existsSync(png) || fs.statSync(png).size < 10000) {
    throw new Error(`${name}: the installed app saved no screenshot (exit ${result.status}${result.error ? `, ${result.error.message}` : ''})`);
  }
  say(`screen ${name}: ${png} (${Math.round(fs.statSync(png).size / 1024)} KB)`);
}
say('Windows smoke test passed');
