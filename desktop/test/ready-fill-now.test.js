// Fill now (owner, 18 Oct 2026: "I press Fill now and nothing really happens", "I'd expect it to start instantly", "make the Fill now work"): one press sends tonight's
// ready jobs and starts them; jobs you opened but did not submit are filled again only after a yes; a send that would replace forms still waiting for you asks first.
// The plan is pure (lib/ready-fill-now.js); the handler (lib/ready-handlers.js) sends, then starts, and the card shows its progress (renderer/pages/ready-progress.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {install} from './tiny-dom.js';
import {fillNowPlan, waitingOn} from '../lib/ready-fill-now.js';

install();   // components.js builds elements as it loads
const {progressOf} = await import('../renderer/pages/ready-progress.js');

const job = (code, extra = {}) => ({code, title: `Job ${code}`, company: 'Acme', ...extra});

test('every case of Fill now: send at once, ask first, or say there is nothing to fill', () => {
  const ready = [job('a'), job('b')], opened = [job('x')];
  const cases = [
    ['ready jobs, nothing waiting: send them now', {tonight: ready, opened, waiting: 0}, {send: ready}],
    ['ready jobs, but last night\'s forms still wait: ask first', {tonight: ready, opened, waiting: 2}, {ask: {again: false, jobs: ready, replaces: 2}}],
    ['the same, after the yes: send', {tonight: ready, opened, waiting: 2, confirmed: true}, {send: ready}],
    ['nothing ready, but opened jobs: offer to fill them again', {tonight: [], opened, waiting: 0}, {ask: {again: true, jobs: opened, replaces: 0}}],
    ['filling again, after the yes: send the opened jobs', {tonight: [], opened, waiting: 1, again: true, confirmed: true}, {send: opened}],
    ['nothing ready, nothing opened: nothing to fill', {tonight: [], opened: [], waiting: 0}, {nothing: true}],
  ];
  for (const [name, given, expected] of cases) assert.deepEqual(fillNowPlan(given), expected, name);
});

test('the forms a send would replace: only this night\'s, filled, not yet submitted or done', () => {
  const rows = {batch: {night: '2026-10-18'}, jobs: [{state: 'prepared'}, {state: 'partial'}, {state: 'failed'}, {state: 'prepared', submitted_at: 'x'}, {state: 'prepared', cleared_at: 'x'}]};
  assert.equal(waitingOn(rows, '2026-10-18'), 2);
  assert.equal(waitingOn(rows, '2026-10-19'), 0, 'another night is never replaced');
  assert.equal(waitingOn({}, '2026-10-18'), 0);
});

// The card's bar: Sent > Starting the server > Filling k of n > Ready, from what the card knows (its own press, then the site's night).
test('the progress bar follows the press, then the server\'s night, step by step', () => {
  const steps = p => p.steps.map(step => `${step.label}:${step.state}`);
  const sending = progressOf({phase: 'sending'});
  assert.deepEqual(steps(sending), ['Sending:now', 'Starting the server:todo', 'Filling:todo', 'Ready:todo']);
  const starting = progressOf({phase: 'started', batch: {state: 'queued'}, jobs: [{state: 'queued'}, {state: 'queued'}]});
  assert.deepEqual(steps(starting), ['Sent 2 jobs:done', 'Starting the server:now', 'Filling:todo', 'Ready:todo']);
  const filling = progressOf({phase: 'started', batch: {state: 'running'}, jobs: [{state: 'prepared'}, {state: 'queued'}]});
  assert.deepEqual(steps(filling), ['Sent 2 jobs:done', 'Server up:done', 'Filling 2 of 2:now', 'Ready:todo']);
  const done = progressOf({phase: 'started', batch: {state: 'finished'}, jobs: [{state: 'prepared'}, {state: 'partial'}]});
  assert.deepEqual(steps(done), ['Sent 2 jobs:done', 'Server up:done', 'Filled 2:done', 'Ready:done']);
  assert.ok(sending.percent < starting.percent && starting.percent < filling.percent && filling.percent < done.percent && done.percent === 100, 'the bar only grows');
  assert.equal(progressOf({phase: 'idle', batch: {state: 'finished'}, jobs: []}), null, 'no press and no running night: no bar');
  assert.ok(progressOf({phase: 'idle', batch: {state: 'running'}, jobs: [{state: 'queued'}]}), 'a night running by itself (the cron) shows the bar too');
  assert.equal(progressOf({phase: 'failed', error: 'x'}).steps[0].state, 'bad');
});

// The window's handler, with the site faked at fetch: what one press of Fill now sends and starts, and when it asks first.
test('Fill now: one press sends and starts; it asks before replacing waiting forms or filling opened jobs again; nothing ready is said plainly', async () => {
  const {registerReadyHandlers} = await import('../lib/ready-handlers.js');
  const {useKeychainReader} = await import('../lib/ready-site.js');
  useKeychainReader(() => null);   // no test reads this Mac's Keychain
  const done = {kit: true, tailored: true, letter: true, fit: 90};
  const ready = {code: 'a', url: 'https://boards.example.com/a', title: 'SRE', company: 'Acme', status: 'saved', ...done};
  const opened = {code: 'x', url: 'https://boards.example.com/x', title: 'DevOps', company: 'Nordlicht', status: 'applying', ...done};
  let list = [ready, opened], night = {ok: true, batch: null, jobs: []};
  const sent = [], kept = {};
  const answer = (body, status = 200) => new Response(JSON.stringify(body), {status});
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const route = new URL(url).pathname;
    if (route.endsWith('/ready/state')) return answer(night);
    if (route.endsWith('/ready/batch')) { const jobs = JSON.parse(init.body).jobs.map(job => job.id); sent.push(['batch', jobs]); return answer({ok: true, queued: jobs.length}); }
    if (route.endsWith('/ready/run')) { sent.push(['run']); return answer({ok: true, batch: 'b1'}, 202); }
    return answer({ok: true});
  };
  const handlers = {}, ipcMain = {handle: (name, fn) => { handlers[name] = fn; }};
  const storage = {secret: name => (/TRIAL/.test(name) ? 'JPF1.install.token' : ''), settings: () => kept, saveSettings: patch => Object.assign(kept, patch), path: name => `/nowhere/${name}`};
  try {
    registerReadyHandlers({ipcMain, storage, deps: {jobs: async () => list, store: {findJob: async () => ({id: 1}), kit: async () => ({answers: [], cover_letter: 'Dear Acme'})},
      me: async () => ({contact: {name: 'Alex Example'}, resume: {data: 'JVBERi0='}}), facts: async () => ({})}});
    const pressed = await handlers.readyRun({}, {});
    assert.equal(pressed.ok, true, JSON.stringify(pressed));
    assert.deepEqual(sent, [['batch', ['a']], ['run']], 'tonight\'s ready job only, sent then started');
    assert.ok(kept.ready.ranNight, 'a started night is never replaced by the automatic send');

    sent.length = 0;
    const {nightOf} = await import('../lib/ready-batch.js');
    night = {ok: true, batch: {night: nightOf().night, state: 'finished'}, jobs: [{job: 'a', state: 'prepared'}]};
    const asked = await handlers.readyRun({}, {});
    assert.deepEqual(asked.ask, {again: false, jobs: [{code: 'a', name: 'SRE · Acme'}], replaces: 1});
    assert.deepEqual(sent, [], 'nothing sent before the yes');
    assert.equal((await handlers.readySend({}, {})).ask.replaces, 1, 'Fill tonight asks the same');
    assert.equal((await handlers.readyRun({}, {confirmed: true})).ok, true);
    assert.deepEqual(sent, [['batch', ['a']], ['run']]);

    sent.length = 0; list = [opened]; night = {ok: true, batch: null, jobs: []};
    const again = await handlers.readyRun({}, {});
    assert.deepEqual(again.ask, {again: true, jobs: [{code: 'x', name: 'DevOps · Nordlicht'}], replaces: 0}, 'only opened jobs left: fill them again?');
    assert.equal((await handlers.readySend({}, {})).nothing, true, 'Fill tonight never takes opened jobs');
    assert.equal((await handlers.readyRun({}, {again: true, confirmed: true})).ok, true);
    assert.deepEqual(sent, [['batch', ['x']], ['run']]);

    sent.length = 0; list = [];
    const nothing = await handlers.readyRun({}, {});
    assert.equal(nothing.nothing, true);
    assert.match(nothing.error, /Nothing to fill/);
    assert.doesNotMatch(nothing.error, /not on for this install/);
    assert.deepEqual(sent, []);
  } finally { globalThis.fetch = realFetch; }
});
