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
say(py(['-c', 'import anthropic, keyring, sqlite3, ssl, sherpa_onnx, av, numpy, sys; from importlib.metadata import version; ' +
  "print('Python', sys.version.split()[0], 'anthropic', version('anthropic'), 'keyring', version('keyring'))"]));
say(py(['-c', "from src import secret_store as s; s.put('job-pilotto.smoke.test', 'ok', 'ci'); " +
  "v = s.get('job-pilotto.smoke.test', 'ci'); s.delete('job-pilotto.smoke.test', 'ci'); " +
  "assert v == 'ok', v; assert s.get('job-pilotto.smoke.test', 'ci') is None; print('Credential Manager round-trip ok')"]));
// The audio half of interview transcription: PyAV's bundled ffmpeg decoding a real file. The recogniser's models are
// a 520 MB download, so CI doesn't run those — but importing `av` proves nothing about whether its native codecs
// load on Windows, and this does.
say(py(['-c', `
import os, tempfile, wave
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
`]));
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
  ['wizard-notion', waitForJobs, DONE,
    `({step: ${ACTIVE_STEP}, controls: document.querySelectorAll('.step[data-step="notion"] button, .step[data-step="notion"] input').length})`,
    ({step, controls}) => [step === 'notion' && controls >= 1, `the Notion step is up with its controls rendered (${controls})`]],
  ['settings-connections', openConnections, DONE,
    `({view: ([...document.querySelectorAll('.view')].find(v => !v.hidden) || {}).dataset?.view || '', status: (document.getElementById('ext-status') || {}).textContent || '', steps: document.querySelectorAll('#ext-setup li').length})`,
    ({view, status, steps}) => [view === 'settings' && steps >= 3 && status.length > 0,
      `Settings → Connections drew its extension steps (${steps}) and read the state as "${status}"`]],
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
say('Windows smoke test passed');
