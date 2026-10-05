// Windows smoke test (CI, after the installer is built): installs Job Pilotto the way a user would, then checks
// the installed app, not the source tree.
//   node scripts/windows-smoke.mjs <installer.exe> <output folder>
// 1. Silent per-user install (%LOCALAPPDATA%\Programs\…).
// 2. The bundled Python starts and imports what the pipeline and the Credential Manager need;
//    the transcription add-on (not in the installer) installs itself with pip and then loads, PyAV decoding a real file;
//    a secret round-trips through the Credential Manager; the pipeline lists (no) jobs from an empty folder.
// 3. The installed app renders three screens (welcome, the wizard's extras with the Apply with Claude
//    checklist, the Jobs page) in smoke mode (JOB_PILOTTO_SMOKE); screenshots go to the output folder.
// Any failure exits non-zero, so the release isn't published with a Windows app that doesn't start.
import {execFileSync, spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {windowsUpdateScript} from '../lib/updater.js';

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
say(py(['-c', 'import anthropic, keyring, pip, sqlite3, ssl, sys; from importlib.metadata import version; ' +
  "print('Python', sys.version.split()[0], 'anthropic', version('anthropic'), 'keyring', version('keyring'))"]));
say(py(['-c', "from src import secret_store as s; s.put('job-pilotto.smoke.test', 'ok', 'ci'); " +
  "v = s.get('job-pilotto.smoke.test', 'ci'); s.delete('job-pilotto.smoke.test', 'ci'); " +
  "assert v == 'ok', v; assert s.get('job-pilotto.smoke.test', 'ci') is None; print('Credential Manager round-trip ok')"]));
// The transcription add-on is downloaded on the first recording (src/ai/transcribe.py install_addon): do exactly that here,
// into a throwaway folder, so a Windows wheel that goes missing fails the release instead of a user's first interview.
const models = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-models-'));
say(py(['-c', "from src.ai import transcribe as t; assert not t.libraries(), 'bundled after all'; t.install_addon(); " +
  "assert t.libraries(), 'installed but not loadable'; import sherpa_onnx, numpy; print('Add-on installed:', t.addon_dir())"],
{JOB_PILOTTO_MODELS_DIR: path.join(models, 'models')}));
// The audio half of interview transcription: PyAV's bundled ffmpeg decoding a real file. The recogniser's models are
// a 520 MB download, so CI doesn't run those — but importing `av` proves nothing about whether its native codecs
// load on Windows, and this does.
say(py(['-c', `
import os, tempfile, wave
from src.ai import transcribe
transcribe.use_addon()
import av
folder = tempfile.mkdtemp(prefix='jp-av-')
path = os.path.join(folder, 'tone.wav')
with wave.open(path, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    w.writeframes(bytes([0, 0]) * 16000)
with av.open(path) as container:
    frames = list(container.decode(audio=0))
samples = sum(f.samples for f in frames)
assert samples >= 16000, samples
os.remove(path); os.rmdir(folder)
print('PyAV decoded', samples, 'samples at', frames[0].sample_rate, 'Hz')
`], {JOB_PILOTTO_MODELS_DIR: path.join(models, 'models')}));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-smoke-data-'));
for (const sub of ['config', 'data']) fs.mkdirSync(path.join(data, sub), {recursive: true});
for (const name of fs.readdirSync(path.join(pilot, 'config')).filter(n => n.endsWith('.json'))) {
  fs.copyFileSync(path.join(pilot, 'config', name), path.join(data, 'config', name));
}
const jobs = py(['-m', 'src.desktop', 'jobs'], {JOB_PILOTTO_NO_DOTENV: '1', JOB_PILOTTO_CONFIG_DIR: path.join(data, 'config'),
  JOB_PILOTTO_DATA_DIR: path.join(data, 'data')}).split(/\r?\n/).pop();
JSON.parse(jobs);
say(`pipeline jobs list ok: ${jobs.slice(0, 80)}`);

// The app's own screens. Fresh data folders each time; the third has setup done but no Notion key (it can't be
// made here), so the app asks for Notion again: the wizard's Notion step, with the rest of the app loaded.
const extras = `(() => { document.querySelectorAll('.step').forEach(s => { s.hidden = s.dataset.step !== 'extras'; }); })()`;
const waitForJobs = `new Promise(resolve => setTimeout(resolve, 8000))`;
// Settings → Connections, where the extension's state and its install steps live: the pane a PC user is sent to
// when the extension isn't reporting, and the one whose state was previously read twice and disagreed with itself.
const openConnections = `(async () => {
  document.querySelector('.nav[data-view="settings"]').click();
  await new Promise(r => setTimeout(r, 800));
  [...document.querySelectorAll('[data-settings-go]')].find(b => b.dataset.settingsGo === 'connections').click();
  await new Promise(r => setTimeout(r, 3000));
})()`;
const DONE = {setupDone: true, autoSearch: false, lastSearchAt: '2099-01-01T00:00:00.000Z',
  notionIds: {NOTION_APPLICATIONS_DB: 'smoke', NOTION_MATCHES_DB: 'smoke', NOTION_PROFILE_PAGE_ID: 'smoke', NOTION_ANSWERS_PAGE_ID: 'smoke'}};
// Updating itself: the app hands a PowerShell script the job of waiting for it to exit, installing quietly and
// reopening it. That script is the one part of the update that cannot be exercised from a Mac, so it is run here —
// with stubs standing in for the installer and the app, since a run can only install itself once.
{
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-smoke-update-'));
  const flag = path.join(folder, 'flag.txt'), reopened = path.join(folder, 'reopened.txt');
  const stubInstaller = path.join(folder, 'stub-installer.cmd'), stubApp = path.join(folder, 'stub-app.cmd');
  fs.writeFileSync(stubInstaller, `@echo off\r\necho %1> "${flag}"\r\n`);
  fs.writeFileSync(stubApp, `@echo off\r\necho reopened> "${reopened}"\r\n`);
  // Something to wait for that is still running when the script starts: a ping that takes about three seconds.
  const sleeper = spawn('cmd.exe', ['/c', 'ping -n 4 127.0.0.1 >nul'], {stdio: 'ignore'});
  const script = path.join(folder, 'update.ps1');
  fs.writeFileSync(script, windowsUpdateScript(sleeper.pid, stubInstaller, stubApp));
  const started = Date.now();
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {stdio: 'inherit', timeout: 60000});
  const took = Date.now() - started;
  // The script opens the app without waiting for it — right for the real one, which must not outlive its job — so a
  // stub may write its file a moment after PowerShell has exited.
  for (let i = 0; i < 40 && !fs.existsSync(reopened); i++) await new Promise(resolve => setTimeout(resolve, 250));
  const passed = fs.existsSync(flag) ? fs.readFileSync(flag, 'utf8').trim() : '';
  if (passed !== '/S') throw new Error(`the update ran the installer without /S (argument was "${passed}")`);
  if (!fs.existsSync(reopened)) throw new Error('the update did not reopen the app after installing');
  if (took < 1500) throw new Error(`the update did not wait for the app to exit (finished in ${took} ms)`);
  say(`update ok on Windows: waited ${took} ms for the app, installed with /S, reopened it`);
}
// The in-app terminal (Apply with Claude sessions): node-pty loads in the installed app and runs a command.
{
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-smoke-pty-'));
  const result = path.join(userData, 'pty.txt');
  spawnSync(exe, [], {timeout: 90000, stdio: 'inherit', env: {...process.env, JOB_PILOTTO_USER_DATA: userData,
    JOB_PILOTTO_SMOKE: path.join(userData, 'pty.png'), JOB_PILOTTO_SMOKE_JS: 'new Promise(r => setTimeout(r, 5000))', JOB_PILOTTO_PTY_SMOKE: result}});
  const text = fs.existsSync(result) ? fs.readFileSync(result, 'utf8') : 'no result file';
  if (!text.includes('pty-ok')) throw new Error(`in-app terminal: ${text.slice(0, 300)}`);
  say('in-app terminal ok (node-pty ran cmd.exe in the installed app)');
}
// What each screen must actually report back, not just that a picture was taken: a blank or half-built window
// still saves one. JOB_PILOTTO_SMOKE_EVAL is evaluated in the window and written beside the screenshot as JSON.
const ACTIVE_STEP = `([...document.querySelectorAll('.step')].find(s => !s.hidden) || {}).dataset?.step || ''`;
const SCREENS = [
  ['welcome', '', null, `({step: ${ACTIVE_STEP}, wizard: !document.getElementById('wizard').hidden})`,
    ({wizard}) => [wizard === true, 'the setup wizard is up']],
  ['wizard-extras', extras, null, `({step: ${ACTIVE_STEP}, checklist: document.querySelectorAll('#claude-prereqs li').length})`,
    ({checklist}) => [checklist >= 3, `the Apply with Claude checklist rendered (${checklist} items)`]],
  ['jobs-without-notion', waitForJobs, DONE,
    `({view: ([...document.querySelectorAll('.view')].find(v => !v.hidden) || {}).dataset?.view || '', wizard: !document.getElementById('wizard').hidden})`,
    ({view, wizard}) => [view === 'jobs' && wizard === false, `a set-up app without a Notion token opens the Jobs list, not the wizard (view "${view}")`]],
  ['settings-connections', openConnections, DONE,
    `({view: ([...document.querySelectorAll('.view')].find(v => !v.hidden) || {}).dataset?.view || '', status: (document.getElementById('ext-status') || {}).textContent || '', steps: document.querySelectorAll('#ext-setup li').length, looked: (document.getElementById('ext-looked') || {}).textContent || ''})`,
    ({view, status, steps, looked}) => [view === 'settings' && steps >= 3 && status.length > 0 && looked.includes('Looked in'),
      `Settings → Connections drew its extension steps (${steps}), read the state as "${status}" and listed where it looked`]],
];
for (const [name, js, settings, evalJs, ok] of SCREENS) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-smoke-'));
  if (settings) fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(settings));
  const png = path.join(out, `windows-${name}.png`);
  const result = spawnSync(exe, [], {timeout: 90000, stdio: 'inherit',
    env: {...process.env, JOB_PILOTTO_USER_DATA: userData, JOB_PILOTTO_SMOKE: png, JOB_PILOTTO_SMOKE_JS: js, JOB_PILOTTO_SMOKE_EVAL: evalJs}});
  if (!fs.existsSync(png) || fs.statSync(png).size < 10000) {
    throw new Error(`${name}: the installed app saved no screenshot (exit ${result.status}${result.error ? `, ${result.error.message}` : ''})`);
  }
  const reported = fs.existsSync(`${png}.json`) ? JSON.parse(fs.readFileSync(`${png}.json`, 'utf8')) : null;
  if (!reported || reported.error) {
    throw new Error(`${name}: the window answered nothing (${reported ? reported.error : `no ${path.basename(png)}.json`})`);
  }
  const [passed, what] = ok(reported);
  if (!passed) throw new Error(`${name}: expected ${what}, the window reported ${JSON.stringify(reported)}`);
  say(`screen ${name}: ${what} · ${path.basename(png)} (${Math.round(fs.statSync(png).size / 1024)} KB)`);
}
// Installing over an install, which is what an update really is: the app quits and /S replaces it where it stands.
// Every check above ran against a fresh install on a bare runner, so "replace what is there" was never tried — and
// that is the half of the update this machine can prove without a second release.
{
  execFileSync(path.resolve(installer), ['/S'], {stdio: 'inherit', timeout: 5 * 60 * 1000});
  if (!fs.existsSync(exe)) throw new Error(`the app is gone after installing over itself: ${exe}`);
  say(py(['-c', "print('the bundled Python still runs after installing over it')"]));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-smoke-over-'));
  const png = path.join(out, 'windows-install-over.png');
  spawnSync(exe, [], {timeout: 90000, stdio: 'inherit',
    env: {...process.env, JOB_PILOTTO_USER_DATA: userData, JOB_PILOTTO_SMOKE: png, JOB_PILOTTO_SMOKE_JS: '',
      JOB_PILOTTO_SMOKE_EVAL: `({wizard: !document.getElementById('wizard').hidden})`}});
  const reported = fs.existsSync(`${png}.json`) ? JSON.parse(fs.readFileSync(`${png}.json`, 'utf8')) : null;
  if (!reported?.wizard) throw new Error(`the app did not start after installing over it (${reported ? JSON.stringify(reported) : 'no answer'})`);
  say('installing over an existing install ok: replaced quietly, and the app still starts');
}
say('Windows smoke test passed');
