// One screen, fast (~5 s), to check a change: npm run shot -- <page> [options]. Fictional demo data only (demo/).
//   pages: focus, jobs, session, actions, strategy, interviews, settings
//   --select <css>     only that element (and a small margin), e.g. '#ss-decision'
//   --session <text>   on the session page, open the session whose card contains this text (e.g. Acme)
//   --log              expand the session log
//   --reload           reload the window (⌘R) afterwards, and expand the log again if --log
//   --js <code>        more steps to run first (a statement; await allowed)
//   --eval <expr>      write this expression's value as JSON (window.__jp has the state; __jp.terminal() the log)
//   --no-picture       only the --eval result, no screenshot
//   --output <file>    a recorded terminal output to show as the session's log (e.g. a real session's)
//   --width <px>       the window's width, to check a narrow layout (default 1280; the window's minimum is lib/main-window.js MIN_WIDTH)
//   --out <file.png>   where the picture goes (default: $TMPDIR/job-pilotto-shot.png)
//   --settings <json>  merged into the demo's settings.json first (a state the demo lacks: '{"store":"sqlite"}')
// The full reference set is npm run ui-shots (only after big UI changes, or when asked).
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = path.join(desktop, 'node_modules', '.bin', 'electron');
const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const VALUED = ['select', 'session', 'js', 'eval', 'output', 'out', 'width', 'settings'];
const page = args.find((arg, i) => !arg.startsWith('--') && !VALUED.includes(args[i - 1]?.slice(2))) || 'focus';

const wait = ms => `await new Promise(r => setTimeout(r, ${ms}));`;
const expandLog = `if (document.getElementById('ss-log-body').hidden) document.getElementById('ss-expand').click(); ${wait(1500)}`;
const steps = [];
if (page === 'session') {
  steps.push(`document.getElementById('sd-all').click(); ${wait(1500)}`);
  if (option('session')) steps.push(`[...document.querySelectorAll('#ss-list > *')].find(n => n.textContent.includes(${JSON.stringify(option('session'))}))?.click(); ${wait(1000)}`);
  if (flag('log')) steps.push(expandLog);
} else steps.push(`document.querySelector('.nav[data-view=${page}]')?.click(); ${wait(1500)}`);
if (option('js')) steps.push(option('js'));
const script = code => `(async () => { ${code} })()`;

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-shot-'));
for (const file of fs.readdirSync(path.join(desktop, 'demo'))) if (file !== 'jobs.json') fs.copyFileSync(path.join(desktop, 'demo', file), path.join(data, file));
// --settings '<json>': merged into the demo copy's settings.json, to render a state the demo doesn't have (e.g. '{"store":"sqlite"}').
if (option('settings')) {
  const file = path.join(data, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({...JSON.parse(fs.readFileSync(file, 'utf8')), ...JSON.parse(option('settings'))}, null, 2));
}
const out = path.resolve(option('out') || path.join(os.tmpdir(), 'job-pilotto-shot.png'));
fs.rmSync(`${out}.json`, {force: true});
const env = {...process.env, JOB_PILOTTO_DEMO: '1', JOB_PILOTTO_USER_DATA: data, JOB_PILOTTO_SMOKE: out, JOB_PILOTTO_SMOKE_JS: script(steps.join('\n'))};
if (option('width')) env.JOB_PILOTTO_SHOT_WIDTH = option('width');
if (flag('reload')) env.JOB_PILOTTO_SMOKE_RELOAD_JS = script(flag('log') ? expandLog : wait(500));
if (option('select')) env.JOB_PILOTTO_SMOKE_SELECTOR = option('select');
if (option('eval')) env.JOB_PILOTTO_SMOKE_EVAL = option('eval');
if (flag('no-picture')) env.JOB_PILOTTO_SMOKE_NO_PICTURE = '1';
if (option('output')) env.JOB_PILOTTO_DEMO_OUTPUT = path.resolve(option('output'));
const started = Date.now();
const run = spawnSync(electron, ['.'], {cwd: desktop, env, timeout: 90000, encoding: 'utf8'});
fs.rmSync(data, {recursive: true, force: true});
const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (!flag('no-picture')) {
  if (!fs.existsSync(out)) { console.error(`no picture (the steps failed?)\n${(run.stderr || '').split('\n').filter(line => /error/i.test(line)).slice(0, 5).join('\n')}`); process.exit(1); }
  console.log(`${out} (${seconds} s)`);
}
if (option('eval')) console.log(fs.existsSync(`${out}.json`) ? fs.readFileSync(`${out}.json`, 'utf8') : 'no --eval result');
