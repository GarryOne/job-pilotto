// Reference screenshots of every screen, for the ui-look-and-feel skill (.claude/skills/ui-look-and-feel):
// what the app looks like today, so a new page or section is built to match. Fictional demo data only (demo/),
// never a real profile. Run after a screen changes: npm run ui-shots  →  docs/ui/<screen>.jpg
import {spawnSync, execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(desktop, 'docs', 'ui');
const electron = path.join(desktop, 'node_modules', '.bin', 'electron');
const wait = ms => `new Promise(r => setTimeout(r, ${ms}))`;
const open = view => `document.querySelector('.nav[data-view=${view}]').click();`;

// name, what it shows (for the skill's table), the script to reach it, extra environment.
export const SCREENS = [
  ['focus', 'Focus: Up next rows, Insight, funnel; side column (progress, reminders, your focus); sessions dock', `${open('focus')} ${wait(900)}`],
  ['focus-loading', 'Loading state: skeleton cards in the page\'s shape, "Syncing…" by Refresh', `${open('focus')} ${wait(900)}`,
    {JOB_PILOTTO_DEMO_FOCUS_DELAY: '60000'}],
  ['jobs', 'Jobs: stat tiles, toolbar, job rows (fit ring, tags, status pill, main action, ⋯)', `${open('jobs')} ${wait(1200)}`],
  ['session', 'Session page: list, job header, decision card, live terminal, message box, quick replies',
    `document.getElementById('sd-all').click(); ${wait(1500)}`],
  ['actions', 'Actions: two labelled sections (Run now / Look up) and the Status card',
    `${open('actions')} document.querySelector('[data-command=status]').click(); ${wait(1200)}`],
  ['interviews', 'Interviews: recorder, drafts and the saved library table', `${open('interviews')} ${wait(1200)}`],
  ['settings', 'Settings: setting rows (title, explanation, control)', `${open('settings')} ${wait(1200)}`],
  ['strategy', 'Strategy: targeting rows with chips, score bars, Avoid; side glance card', `${open('strategy')} ${wait(2500)}`],
  ['strategy-loading', 'Strategy loading: each card in its final shape, greyed; "Loading strategy…" pill', `${open('strategy')} ${wait(900)}`,
    {JOB_PILOTTO_DEMO_STRATEGY_DELAY: '60000'}],
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(out, {recursive: true});
  for (const [name, , js, env = {}] of SCREENS) {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ui-'));
    for (const file of fs.readdirSync(path.join(desktop, 'demo'))) {
      if (file !== 'jobs.json') fs.copyFileSync(path.join(desktop, 'demo', file), path.join(data, file));
    }
    const png = path.join(data, 'shot.png');
    spawnSync(electron, ['.'], {cwd: desktop, stdio: 'ignore', timeout: 60000, env: {...process.env, ...env,
      JOB_PILOTTO_DEMO: '1', JOB_PILOTTO_USER_DATA: data, JOB_PILOTTO_SMOKE: png, JOB_PILOTTO_SMOKE_JS: js}});
    if (!fs.existsSync(png)) { console.error(`${name}: no screenshot`); fs.rmSync(data, {recursive: true, force: true}); continue; }
    // 1400 px wide JPEGs: sharp enough to read, small enough for git (~150 KB each).
    execFileSync('sips', ['-Z', '1400', '-s', 'format', 'jpeg', '-s', 'formatOptions', '78', png, '--out', path.join(out, `${name}.jpg`)], {stdio: 'ignore'});
    fs.rmSync(data, {recursive: true, force: true});
    console.log(`docs/ui/${name}.jpg`);
  }
}
