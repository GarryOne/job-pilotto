// The website's demo: the app's screens (fictional demo data, never a real profile) as one silent looping video,
// shown in a Mac window drawn by the page (site/public: .mac-window). Plays like a GIF, but sharp and small.
// Run after the UI changes: npm run site-demo  (npm run site-demo -- calendar: only that close-up)  →  site/public/images/app/demo.mp4, demo-poster.jpg and snips/*.png
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(desktop, '..', 'site', 'public', 'images', 'app');
const electron = path.join(desktop, 'node_modules', '.bin', 'electron');
const wait = ms => `new Promise(r => setTimeout(r, ${ms}))`;
const open = view => `document.querySelector('.nav[data-view=${view}]').click();`;

// The story, in order: what to do next, the jobs, applying, Claude asking, what ran, the rest.
const FRAMES = [
  ['focus', `${open('focus')} ${wait(1200)}`],
  ['jobs', `${open('jobs')} ${wait(1500)}`],
  ['apply', `${open('jobs')} ${wait(1200)}; document.getElementById('apply-open').click(); ${wait(500)}`],
  ['session', `document.getElementById('sd-all').click(); ${wait(1800)}`],
  ['activity', `${open('focus')} ${wait(900)}; document.getElementById('activity-toggle').click(); ${wait(900)}`],
  ['actions', `${open('actions')} ${wait(1500)}`],
  ['strategy', `${open('strategy')} ${wait(2500)}`],
  ['calendar', `${open('calendar')} ${wait(2500)}`],
  ['interviews', `${open('interviews')} ${wait(1500)}`],
];
const HOLD = 2.6, FADE = 0.4;
// Close-ups for the carousel under the video: one element each (JOB_PILOTTO_SMOKE_SELECTOR), not whole windows.
const steps = (...parts) => `(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms)); ${parts.join('; ')}; })()`;
const go = view => `document.querySelector('.nav[data-view=${view}]').click()`;
const noDock = `document.getElementById('sessions-dock').style.display = 'none'`;  // it sits over the page's bottom
// [name, selector, steps, margin around it in px]
const SNIPS = [
  ['claude-asks', '#ss-decision', steps(`document.getElementById('sd-all').click()`, 'await sleep(1800)'), 12],
  ['up-next', '.focus-main > .card', steps(go('focus'), 'await sleep(1200)', noDock), 12],
  ['job-row', '.job-row', steps(go('jobs'), 'await sleep(1500)', noDock), 4],
  ['sessions', '#sessions-dock', steps(go('focus'), 'await sleep(1200)'), 0],
  ['activity', '#activity-panel', steps(go('focus'), 'await sleep(900)', `document.getElementById('activity-toggle').click()`, 'await sleep(900)'), 0],
  ['funnel', '#focus-funnel', steps(go('focus'), 'await sleep(1200)', noDock), 12],
  ['calendar', '.cal-layout', steps(go('calendar'), 'await sleep(2500)', noDock), 12],
  ['interview', '#iv-editor', steps(go('interviews'), 'await sleep(1200)', `document.querySelector('.iv-draft button')?.click()`, 'await sleep(1200)', noDock), 12],
];

const only = process.argv[2] || '';  // a close-up's name: redo just that one, leave the video and the other pictures alone
const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-demo-frames-'));
for (const [name, js] of only ? [] : FRAMES) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-demo-'));
  for (const file of fs.readdirSync(path.join(desktop, 'demo'))) {
    if (file !== 'jobs.json') fs.copyFileSync(path.join(desktop, 'demo', file), path.join(data, file));
  }
  const png = path.join(frames, `${name}.png`);
  spawnSync(electron, ['.'], {cwd: desktop, stdio: 'ignore', timeout: 60000, env: {...process.env,
    JOB_PILOTTO_DEMO: '1', JOB_PILOTTO_USER_DATA: data, JOB_PILOTTO_SMOKE: png, JOB_PILOTTO_SMOKE_JS: js}});
  fs.rmSync(data, {recursive: true, force: true});
  if (!fs.existsSync(png)) throw new Error(`${name}: no screenshot`);
  execFileSync('sips', ['-z', '1024', '1600', png], {stdio: 'ignore'});  // one size for all (Retina captures are 2x)
  console.log(`frame ${name}`);
}
fs.mkdirSync(path.join(out, 'snips'), {recursive: true});
for (const [name, selector, js, margin] of SNIPS.filter(([name]) => !only || name === only)) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-snip-'));
  for (const file of fs.readdirSync(path.join(desktop, 'demo'))) {
    if (file !== 'jobs.json') fs.copyFileSync(path.join(desktop, 'demo', file), path.join(data, file));
  }
  const png = path.join(out, 'snips', `${name}.png`);
  spawnSync(electron, ['.'], {cwd: desktop, stdio: 'ignore', timeout: 60000, env: {...process.env, JOB_PILOTTO_DEMO: '1',
    JOB_PILOTTO_USER_DATA: data, JOB_PILOTTO_SMOKE: png, JOB_PILOTTO_SMOKE_JS: js, JOB_PILOTTO_SMOKE_SELECTOR: selector, JOB_PILOTTO_SMOKE_MARGIN: String(margin)}});
  fs.rmSync(data, {recursive: true, force: true});
  if (!fs.existsSync(png)) throw new Error(`${name}: no close-up (${selector})`);
  execFileSync('sips', ['-Z', '1400', png], {stdio: 'ignore'});  // Retina, capped: sharp and not huge
  console.log(`close-up ${name}`);
}
if (only) { fs.rmSync(frames, {recursive: true, force: true}); process.exit(0); }
const names = FRAMES.map(([name]) => name);
const inputs = names.flatMap(name => ['-loop', '1', '-t', String(HOLD + FADE), '-i', path.join(frames, `${name}.png`)]);
let chain = '', last = '[0:v]';
for (let i = 1; i < names.length; i++) {
  const label = i === names.length - 1 ? '[v]' : `[x${i}]`;
  chain += `${last}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${(i * HOLD).toFixed(2)}${label};`;
  last = label;
}
// H.264 (every browser, Safari included), no audio track, fast start: autoplay + loop + muted = a GIF that's sharp.
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', `${chain}[v]scale=1600:-2,format=yuv420p[out]`,
  '-map', '[out]', '-r', '30', '-c:v', 'libx264', '-crf', '24', '-preset', 'slow', '-an', '-movflags', '+faststart',
  path.join(out, 'demo.mp4')]);
execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', path.join(frames, 'focus.png'),
  '--out', path.join(out, 'demo-poster.jpg')], {stdio: 'ignore'});
fs.rmSync(frames, {recursive: true, force: true});
console.log(`wrote demo.mp4 (${names.length} screens) and demo-poster.jpg to ${path.relative(process.cwd(), out)}`);
