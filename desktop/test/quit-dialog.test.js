import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cancel, leftOpen, restart, sessionsOnly, submitted, working} from '../lib/quit-dialog.js';

const label = session => session.company;
const sessions = names => names.map(company => ({company}));

test('only sessions: a title with the count, one line each, what happens, two clear buttons', () => {
  const dialog = sessionsOnly(sessions(['N26', 'Grafana Labs']), label);
  assert.equal(dialog.message, 'Claude is still filling 2 applications');
  assert.match(dialog.detail, /^•  N26\n•  Grafana Labs\n\nQuitting stops them where they are\./);
  assert.match(dialog.detail, /Resume Claude/);
  assert.deepEqual(dialog.buttons, ['Keep working', 'Stop and quit']);
  assert.equal(sessionsOnly(sessions(['N26']), label).message, 'Claude is still filling an application');
});

test('a long list is cut with "and N more", never a wall of job titles', () => {
  const dialog = sessionsOnly(sessions(['A', 'B', 'C', 'D', 'E', 'F']), label);
  assert.equal(dialog.detail.split('\n').filter(line => line.startsWith('•')).length, 5);
  assert.match(dialog.detail, /•  and 2 more/);
});

test('a search, waiting tasks and sessions together: one line each, then the three choices', () => {
  const dialog = working({busy: {kind: 'search'}, queue: [{kind: 'mail'}, {kind: 'insight'}], sessions: sessions(['N26']), label,
    taskName: kind => ({search: 'New jobs check', mail: 'Gmail check', insight: 'Insight'})[kind]});
  assert.equal(dialog.message, 'Job Pilotto is still working');
  assert.match(dialog.detail, /^•  New jobs check is running\n•  2 tasks waiting: Gmail check, Insight\n•  Claude is filling 1 application: N26\n\n/);
  assert.match(dialog.detail, /Quit when done:.*\nQuit now:/);
  assert.deepEqual(dialog.buttons, ['Quit when done', 'Quit now', 'Cancel']);
  assert.doesNotMatch(working({busy: {kind: 'search'}, taskName: () => 'Search', label}).detail, /Resume Claude/);
});

test('removing a session whose job is still Applying asks whether it was submitted, both answers explained', () => {
  const dialog = submitted('N26');
  assert.equal(dialog.message, 'Did you submit the application to N26?');
  assert.match(dialog.detail, /Yes: it is marked Applied in Notion\.\nNo: it goes back to Kit ready/);
  assert.deepEqual(dialog.buttons, ['Yes, I submitted it', 'No, not submitted', 'Cancel']);
});

test('at start: sessions left open are listed and there are three ways on, the reset explained as not submitted', () => {
  const dialog = leftOpen(sessions(['N26', 'Canonical']), label);
  assert.equal(dialog.message, '2 applications were left open');
  assert.match(dialog.detail, /^•  N26\n•  Canonical\n\nJob Pilotto closed while they were in progress, and they are still marked Applying in Notion\. What now\?/);
  assert.match(dialog.detail, /Keep: they stay in Application sessions; press Resume Claude/);
  assert.match(dialog.detail, /Reset: not submitted\. They go back to Kit ready\.$/);
  assert.deepEqual(dialog.buttons, ['Keep them (recommended)', 'Go through them one by one', 'Reset them all']);
  assert.match(leftOpen(sessions(['N26']), label, 2).detail, /2 others are still open in Chrome and were kept\.$/);
  // Two applications at one company: their titles tell them apart.
  const twice = leftOpen([{company: 'Canonical', title: 'Site Reliability Engineer'}, {company: 'Canonical', title: 'Software Engineer'}, {company: 'N26', title: 'SRE'}], label);
  assert.match(twice.detail, /^•  Canonical · Site Reliability Engineer\n•  Canonical · Software Engineer\n•  N26\n/);
  assert.equal(leftOpen(sessions(['N26']), label).message, 'An application was left open');
});

test('start again from scratch: asked once, says what closes, what starts and that the form tab stays', () => {
  const dialog = restart('Canonical');
  assert.equal(dialog.message, 'Start the Canonical application again from scratch?');
  assert.match(dialog.detail, /This session stops and is closed.*A new Apply with Claude session then starts on the same job.*close it first for an empty form/s);
  assert.deepEqual(dialog.buttons, ['Start again', 'Cancel']);
});

test('cancel: asked once, says the form tab closes (what was filled is lost) and the job goes back to Kit ready', () => {
  const dialog = cancel('Canonical');
  assert.equal(dialog.message, 'Cancel the Canonical application?');
  assert.match(dialog.detail, /the form tab closes in Chrome \(what was filled there is lost\), and the job goes back to Kit ready/);
  assert.deepEqual(dialog.buttons, ['Cancel application', 'Keep it']);
});

// Exercise the main-process quit callback, including the notification before whenIdle.
test('quit when done notifies with the dialog detail and quits after the queue drains', async () => {
  const {readFileSync} = await import('node:fs');
  const {runInNewContext} = await import('node:vm');
  const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const start = source.lastIndexOf('let quitting = false;');
  assert.ok(start >= 0);
  let handler, quit = 0, prevented = 0;
  const notifications = [];
  let drained;
  const idle = new Promise(resolve => { drained = resolve; });
  runInNewContext(source.slice(start), {
    app: {on: (_event, callback) => { handler = callback; }, quit: () => { quit++; }},
    DEMO: false, process: {env: {}}, storage: null, window: null,
    pipeline: {running: () => 'search', queued: () => [], taskName: () => 'Search', whenIdle: () => idle},
    terminals: {running: () => [], label: () => ''},
    nativeImage: {createFromPath: () => ({})}, path: {join: () => ''}, here: '',
    quitDialog: {working: () => ({message: 'Working', detail: 'Search is running', buttons: []})},
    dialog: {showMessageBoxSync: () => 0}, BrowserWindow: {getAllWindows: () => []},
    notify: (...args) => notifications.push(args),
  });
  handler({preventDefault: () => { prevented++; }});
  assert.equal(prevented, 1);
  assert.deepEqual(notifications, [['Job Pilotto will quit when done', 'Search is running']]);
  assert.equal(quit, 0);
  drained();
  await idle;
  assert.equal(quit, 1);
});
