// Every tab and state of a job's drawer, on the demo's fictional jobs (demo/job-pages.json), one picture each cropped to the drawer, then contact
// sheets of six: npm run drawer-shots [-- --only <name,...>] [--out <dir>] [--no-sheets]. ~1 min. Check a drawer change against the boards with
// these, not with one lucky shot. Jobs: 1 applied with everything · 2 screening, a kit, an email · 3 applied, nothing recorded · 4 new, a saved posting
// · 5 rejected, with its review and record · 6 slow to load · 7 fails to load · 8 never scored.
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const dir = path.resolve(option('out') || path.join(os.tmpdir(), 'drawer-shots'));
const only = option('only') ? new Set(option('only').split(',')) : null;

const wait = ms => `await new Promise(r => setTimeout(r, ${ms}));`;
const click = (selector, text) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find(n => ${text ? `n.textContent.trim().startsWith(${JSON.stringify(text)})` : 'true'})?.click(); ${wait(400)}`;
const open = (job, tab, after = '', pre = '') => `${pre} window.__jp.openJob('https://example.com/jobs/${job}', '${tab}'); ${wait(900)} ${after}`;
const GMAIL_OFF = "localStorage.setItem('serviceChecks', JSON.stringify({google: {connected: false}}));";

// [name, steps]
const CASES = [
  ['01-overview-full', open(1, 'overview')],
  ['02-overview-not-stated', open(4, 'overview')],
  ['03-overview-not-scored', open(8, 'overview')],
  ['04-match-scored', open(1, 'match')],
  ['05-match-not-scored', open(8, 'match')],
  ['06-description-saved', open(4, 'description', wait(500))],
  ['07-description-none', open(2, 'description', wait(500))],
  ['08-application-submitted', open(1, 'application')],
  ['09-application-preparation', open(1, 'application', click('.jd-choice button', 'Preparation'))],
  ['10-application-not-prepared', open(3, 'application')],
  ['11-application-no-snapshot', open(3, 'application', click('.jd-choice button', 'Submitted'))],
  ['12-interviews-with-next', open(1, 'interviews')],
  ['13-interviews-none', open(3, 'interviews')],
  ['14-review-rejection', open(5, 'review')],
  ['15-review-none', open(3, 'review')],
  ['16-messages-all', open(1, 'messages')],
  ['17-messages-email-filter', open(1, 'messages', click('.jd-choice button', 'Email'))],
  ['18-messages-none', open(3, 'messages')],
  ['19-messages-gmail-off', open(2, 'messages', '', GMAIL_OFF)],
  ['20-timeline-all', open(1, 'timeline')],
  ['21-timeline-interviews-filter', open(1, 'timeline', click('.jd-choice button', 'Interviews'))],
  ['22-timeline-only-discovered', open(3, 'timeline')],
  ['23-loading', `window.__jp.openJob('https://example.com/jobs/6', 'overview'); ${wait(500)}`],
  ['24-error', open(7, 'overview')],
  ['25-expanded', open(1, 'overview', "document.querySelector('.jd-control[title^=\"Expand\"]').click(); " + wait(400))],
];

fs.mkdirSync(dir, {recursive: true});
const run = ([name, steps]) => new Promise(resolve => {
  const out = path.join(dir, `${name}.png`);
  fs.rmSync(out, {force: true});
  const child = spawn('node', ['scripts/shot.mjs', 'jobs', '--js', steps, '--select', '#job-panel', '--out', out], {cwd: desktop, stdio: 'ignore'});
  child.on('close', () => { console.log(`${fs.existsSync(out) ? 'ok  ' : 'FAIL'} ${name}`); resolve(fs.existsSync(out)); });
});

spawnSync('node', ['scripts/stage.mjs'], {cwd: desktop, stdio: 'ignore'});
const todo = CASES.filter(([name]) => !only || only.has(name) || [...only].some(prefix => name.startsWith(prefix)));
const queue = [...todo], results = [];
await Promise.all(Array.from({length: 3}, async () => { while (queue.length) results.push(await run(queue.shift())); }));
if (!args.includes('--no-sheets')) {   // six a sheet, named, so a reviewer reads a handful of pictures, not twenty-five
  const done = todo.map(([name]) => path.join(dir, `${name}.png`)).filter(file => fs.existsSync(file));
  for (let sheet = 0; sheet * 6 < done.length; sheet += 1) {
    const out = path.join(dir, `sheet-${sheet + 1}.png`);
    spawnSync('magick', ['montage', '-label', '%t', ...done.slice(sheet * 6, sheet * 6 + 6), '-tile', '3x2', '-geometry', '640x560+10+10', '-pointsize', '14', '-background', '#e8edf3', out]);
    console.log(`sheet ${out}`);
  }
}
console.log(`${results.filter(Boolean).length} of ${todo.length} pictures in ${dir}`);
