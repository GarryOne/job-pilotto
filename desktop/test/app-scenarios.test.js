// Offline app journeys through the real preload, checked handlers, terminal persistence, launcher and renderer state.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {test} from 'node:test';
import * as terminals from '../lib/terminals.js';
import {launchInApp, resumeInApp} from '../lib/claude-session.js';
import {registerSessionHandlers} from '../lib/session-handlers.js';
import {installQuitHandling} from '../lib/lifecycle.js';
import {sessionState} from '../renderer/session-state.js';
import {rememberSessions, rememberedSessions} from '../renderer/sessions-cache.js';

const URL = 'https://jobs.example.test/engineer';
const here = path.resolve(import.meta.dirname, '..');
function scenario(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-scenario-'));
  const file = path.join(dir, 'sessions.json');
  const processes = [], commands = [], dialogs = [], choices = [], notifications = [], events = [];
  const listeners = new Map(), handles = new Map(), cache = new Map();
  const localStorage = {getItem: key => cache.get(key), setItem: (key, value) => cache.set(key, value)};
  const settings = {poolInstallId: 'fictional-install'};
  const storage = {settings: () => settings, saveSettings: patch => Object.assign(settings, patch), secret: () => '', path: name => path.join(dir, name)};
  let status = 'kit ready', resetFails = false, consent = true, busy = null, queue = [], idleResolve;
  const idle = new Promise(resolve => { idleResolve = resolve; });
  const pipeline = {
    unapply: async (_storage, url) => {
      assert.equal(url, URL); commands.push('reset Notion');
      if (resetFails) return {ok: false, error: 'Fictional Notion failure'};
      status = 'kit ready'; return {ok: true};
    },
    setStatus: async (_storage, url, next) => { assert.equal(url, URL); commands.push(`Notion ${next}`); status = next; return {ok: true}; },
    running: () => busy, queued: () => queue, taskName: () => 'Search',
    freezeQueue: () => { commands.push('freeze queue'); queue = []; },
    stopRunning: () => { commands.push('stop pipeline'); busy = null; }, whenIdle: () => idle,
  };
  function emit(event, ...args) { for (const fn of listeners.get(event) || []) fn({}, ...structuredClone(args)); }
  terminals._reset(); terminals.persist(file);
  terminals.usePty(async () => ({spawn: (binary, args) => {
    assert.equal(binary, 'fictional-claude');
    const callbacks = {};
    const term = {args, written: [], killed: false,
      onData: fn => { callbacks.data = fn; }, onExit: fn => { callbacks.exit = fn; },
      write: data => term.written.push(data), resize: () => {},
      output: data => callbacks.data(data), exit: code => callbacks.exit({exitCode: code}),
      kill: () => { term.killed = true; callbacks.exit({exitCode: 0}); },
    };
    processes.push(term); return term;
  }}));
  terminals.onChange((event, payload) => { events.push([event, payload]); emit('session', event, payload); });
  terminals.onStatus(() => {});
  registerSessionHandlers({ipcMain: {handle: (name, fn) => {
    assert.ok(!handles.has(name), `duplicate ${name}`); handles.set(name, fn);
  }}, appLog: () => {}, storage, getWindow: () => null, here, DEMO: false,
  dialog: {showMessageBox: async (_window, options) => {
    dialogs.push(options); assert.ok(choices.length, 'scenario must explicitly answer each dialog'); return {response: choices.shift()};
  }}, nativeImage: {createFromPath: () => ({})},
  apply: {applyOne: async (_storage, url) => { commands.push(`apply in Chrome ${url}`); return {ok: true}; },
    claudeOne: async (_storage, url) => { commands.push(`apply with Claude ${url}`); return {ok: true}; },
    resumeSession: (_storage, id) => resumeInApp(storage, id, {claude: 'fictional-claude', platform: 'darwin', watch: () => commands.push('watch submission')})},
  pipeline, review: {queueClose: () => commands.push('close form'), delivered: async () => true},
  server: {openTabs: () => [], sessionSubmitted: () => null}, notion: {call: () => { throw new Error('unexpected live Notion call'); }},
  claudeConsent: async () => consent, closeTab: async () => { throw new Error('unexpected browser fallback'); }, tabs: async () => [],
  });
  let pilot;
  // Execute the entire production preload: typos in exposed calls and event wiring fail these journeys.
  vm.runInNewContext(fs.readFileSync(path.join(here, 'preload.cjs'), 'utf8'), {
    process: {platform: 'darwin'}, require: name => {
      assert.equal(name, 'electron');
      return {contextBridge: {exposeInMainWorld: (name, api) => { assert.equal(name, 'pilot'); pilot = api; }},
        ipcRenderer: {invoke: async (name, ...args) => {
          assert.ok(handles.has(name), `missing handler ${name}`);
          return structuredClone(await handles.get(name)({}, ...structuredClone(args)));
        }, on: (name, fn) => { listeners.set(name, [...listeners.get(name) || [], fn]); }}};
    }, window: {dispatchEvent: () => { throw new Error('outdated preload'); }}, Event: class {},
  });
  pilot.onSession((event, payload) => {
    let items = rememberedSessions(localStorage);
    if (event === 'update') {
      items = items.filter(item => item.id !== payload.id);
      if (!payload.removed) items.push(payload);
      rememberSessions(items, localStorage);
    }
  });
  const appHandlers = new Map();
  const app = {on: (name, fn) => appHandlers.set(name, fn), quit: () => {
    let prevented = false;
    appHandlers.get('before-quit')({preventDefault: () => { prevented = true; }});
    if (!prevented) { commands.push('quit'); appHandlers.get('will-quit')(); }
  }};
  installQuitHandling({app, platform: 'darwin', state: () => ({storage}), pipeline, terminals,
    shouldAskOnQuit: () => false, askWhyLeaving: () => { throw new Error('unexpected setup prompt'); },
    showDialog: (_window, options) => { dialogs.push(options); assert.ok(choices.length); return choices.shift(); },
    icon: () => ({}), getWindows: () => [], toWindow: (...args) => commands.push(args), notify: (...args) => notifications.push(args)});
  t.after(() => {
    terminals.shutdown();
    for (const record of terminals._sessions.values()) record.mirror?.term.dispose();
    terminals._reset(); terminals.onChange(() => {}); terminals.onStatus(() => {});
    for (const term of processes) {
      const settings = term.args[term.args.indexOf('--settings') + 1];
      if (settings) fs.rmSync(path.dirname(settings), {recursive: true, force: true});
    }
    fs.rmSync(dir, {recursive: true, force: true});
  });
  return {pilot, processes, commands, choices, dialogs, events, notifications, app,
    status: () => status, failReset: () => { resetFails = true; }, denyConsent: () => { consent = false; },
    busy: () => { busy = {kind: 'search'}; queue = [{kind: 'kit'}]; }, drain: async () => { busy = null; queue = []; idleResolve(); await idle; },
    start: async () => {
      const [item] = await launchInApp(storage, [URL], {claude: 'fictional-claude', platform: 'darwin', gap: 0,
        ticket: () => '', watch: () => commands.push('watch submission'), details: {[URL]: {title: 'Engineer', company: 'Fictional Labs'}},
        pipelineRun: async (_storage, args) => { assert.deepEqual(args, ['src.ai.apply_batch', '--mark-applying', URL]); status = 'applying'; return {code: 0}; }});
      return item.id;
    },
    question: id => {
      const transcript = path.join(dir, 'transcript.jsonl');
      fs.writeFileSync(transcript, JSON.stringify({type: 'assistant', message: {content: [{type: 'text', text: 'This fictional role is on-site. Continue?'}]}}));
      return terminals.report(id, {event: 'stop', transcript});
    },
    restart: () => {
      terminals.shutdown();
      for (const record of terminals._sessions.values()) record.mirror?.term.dispose();
      terminals._reset(); terminals.persist(file); terminals.restore(Date.now(), {find: () => ''});
    },
    view: async id => {
      const items = await pilot.sessions(); rememberSessions(items, localStorage);
      return items.find(item => item.id === id);
    }, cached: id => rememberedSessions(localStorage).find(item => item.id === id),
  };
}

test('journey: start, receive a question, answer, and hand off for review without submission', async t => {
  const s = scenario(t), id = await s.start();
  assert.equal(sessionState(await s.view(id))[0], 'Applying');
  s.processes[0].output('Fictional terminal output\r\n');
  assert.match((await s.pilot.sessionSnapshot(id)).data, /Fictional terminal output/);
  assert.equal(s.question(id).needsYou, true);
  assert.equal(sessionState(s.cached(id))[0], 'Question for you');
  assert.equal(s.cached(id).question, 'This fictional role is on-site. Continue?');
  assert.match((await s.pilot.sessionTranscript(id))[0].text, /Continue\?/);
  await s.pilot.sessionWrite(id, 'Continue\r');
  assert.deepEqual(s.processes[0].written, ['Continue\r']);
  terminals.report(id, {event: 'prompt'});
  assert.equal(sessionState(s.cached(id))[0], 'Applying');
  terminals.report(id, {event: 'note', message: 'Form filled — review before Submit'});
  s.processes[0].exit(0);
  assert.equal(sessionState(await s.view(id))[0], 'Ready for review');
  assert.equal(sessionState(s.cached(id), true)[0], 'Ready to submit');
  assert.equal(s.status(), 'applying');
  assert.equal(await s.pilot.sessionSubmitted(URL), null);
  assert.ok(!s.commands.includes('Notion applied'));
  s.restart();
  assert.equal(sessionState(await s.view(id))[0], 'Ready for review');
  assert.equal(s.status(), 'applying');
});

test('journey: restart while working, reconcile, and resume the same conversation once', async t => {
  const s = scenario(t), id = await s.start();
  const conversation = terminals.claudeIdOf(id);
  s.restart();
  const restored = await s.view(id);
  assert.equal(restored.live, false); assert.equal(restored.resumable, true); assert.equal(restored.askAtStart, true);
  s.choices.push(0);
  assert.equal((await s.pilot.sessionsLeftOpen([id])).choice, 'keep');
  assert.equal((await s.view(id)).askAtStart, false);
  assert.equal((await s.pilot.sessionResume(id)).ok, true);
  const term = s.processes.at(-1);
  assert.equal(term.args[term.args.indexOf('--resume') + 1], conversation);
  assert.equal(sessionState(await s.view(id))[0], 'Applying');
  assert.equal((await s.pilot.sessionResume(id)).ok, false);
  assert.equal(s.processes.length, 2);
});

test('journey: a waiting question survives restart and resume; consent denial launches nothing', async t => {
  const s = scenario(t), id = await s.start(); s.question(id); s.restart();
  assert.equal(sessionState(await s.view(id))[0], 'Question for you');
  assert.equal((await s.pilot.sessionResume(id)).ok, true);
  assert.equal(sessionState(await s.view(id))[0], 'Question for you');
  assert.ok(!s.processes.at(-1).args.some(arg => arg.includes('Carry on where')));
  s.restart(); s.denyConsent();
  assert.equal((await s.pilot.sessionResume(id)).ok, false); assert.equal(s.processes.length, 2);
});

test('journey: cancel confirmation keeps the session; confirmed cancellation stays removed after restart', async t => {
  const s = scenario(t), id = await s.start();
  s.choices.push(1); assert.equal((await s.pilot.sessionCancel(id)).cancelled, true);
  assert.equal((await s.view(id)).live, true); assert.equal(s.status(), 'applying');
  s.choices.push(0); assert.equal((await s.pilot.sessionCancel(id)).ok, true);
  assert.equal(s.cached(id), undefined); assert.equal(await s.view(id), undefined);
  assert.equal(s.status(), 'kit ready'); assert.equal(s.processes[0].killed, true);
  s.restart(); assert.equal(await s.view(id), undefined);
  assert.equal((await s.pilot.sessionResume(id)).ok, false);
});

test('journey: skip this role resets Applying, dismisses the job and removes the session, with no question', async t => {
  const s = scenario(t), id = await s.start();
  assert.equal((await s.pilot.sessionSkip(id)).ok, true);
  assert.equal(s.status(), 'dismissed'); assert.equal(s.processes[0].killed, true);
  assert.equal(await s.view(id), undefined);
  s.restart(); assert.equal(await s.view(id), undefined);
});

test('journey: skip this role with Notion refusing the reset keeps the session and the job Applying', async t => {
  const s = scenario(t), id = await s.start(); s.failReset();
  assert.equal((await s.pilot.sessionSkip(id)).ok, false);
  assert.equal(s.status(), 'applying'); assert.equal((await s.view(id)).live, false);
});

test('journey: failed Notion reset keeps the stopped session available after restart', async t => {
  const s = scenario(t), id = await s.start(); s.failReset(); s.choices.push(0);
  assert.equal((await s.pilot.sessionCancel(id)).ok, false);
  assert.equal(s.status(), 'applying'); assert.equal((await s.view(id)).live, false);
  s.restart(); assert.equal((await s.view(id)).resumable, true);
  assert.equal((await s.pilot.sessionResume(id)).ok, true);
});

for (const choice of [0, 1, 2]) test(`journey: quit during work, choose ${['when done', 'now', 'cancel'][choice]}`, async t => {
  const s = scenario(t), id = await s.start(); s.busy(); s.choices.push(choice); s.app.quit();
  if (choice === 2) {
    assert.equal((await s.view(id)).live, true); assert.ok(!s.commands.includes('quit'));
    assert.ok(!s.commands.includes('stop pipeline'));
  } else {
    if (choice === 0) {
      assert.ok(!s.commands.includes('quit')); assert.equal(s.notifications.length, 1); await s.drain();
    } else assert.deepEqual(s.commands.slice(-3), ['freeze queue', 'stop pipeline', 'quit']);
    assert.ok(s.commands.includes('quit')); assert.equal(s.processes[0].killed, true);
    s.restart(); assert.equal((await s.view(id)).resumable, true);
  }
});

for (const choice of [0, 1]) test(`journey: quit with only a working session, choose ${choice ? 'stop' : 'keep'}`, async t => {
  const s = scenario(t), id = await s.start(); s.choices.push(choice); s.app.quit();
  if (choice) {
    assert.equal(s.processes[0].killed, true); s.restart(); assert.equal((await s.view(id)).resumable, true);
  } else {
    assert.ok(!s.commands.includes('quit')); assert.equal((await s.view(id)).live, true);
    assert.deepEqual(s.commands.at(-1), ['session', 'open', {id}]);
  }
});

test('journey: closing a review-ready session needs an explicit submission decision; failed reset retains it', async t => {
  const s = scenario(t), id = await s.start();
  terminals.report(id, {event: 'note', message: 'Form filled'});
  s.choices.push(2); assert.equal((await s.pilot.sessionFinish(id)).cancelled, true);
  assert.equal(sessionState(await s.view(id))[0], 'Ready for review');
  s.failReset(); s.choices.push(1); assert.equal((await s.pilot.sessionFinish(id)).ok, false);
  assert.equal(sessionState(await s.view(id))[0], 'Ready for review');
  assert.equal(s.status(), 'applying'); assert.ok(!s.commands.includes('Notion applied'));
});

// Start again never starts Claude by itself (owner, 8 Oct 2026): both ways in (the header's Start again, and Start again
// after the form tab was closed) ask Chrome or Claude, Chrome first; Cancel starts nothing.
for (const [way, call] of [['Start again', (pilot, id) => pilot.sessionRestart(id)], ['tab closed', (pilot, id) => pilot.sessionReopen(id, true)]]) {
  test(`journey: ${way} asks Chrome or Claude, Chrome first, and only Claude starts Claude`, async t => {
    for (const [choice, expected] of [[0, `apply in Chrome ${URL}`], [1, `apply with Claude ${URL}`]]) {
      const s = scenario(t), id = await s.start();
      s.choices.push(choice);
      assert.equal((await call(s.pilot, id)).ok, true);
      assert.equal(s.dialogs[0].buttons[s.dialogs[0].defaultId], way === 'Start again' ? 'Start in Chrome' : 'Keep and reopen');
      assert.match(s.dialogs[0].buttons[0], /Chrome/);
      assert.match(s.dialogs[0].buttons[1], /Claude/);
      assert.deepEqual(s.commands.filter(c => c.startsWith('apply ')), [expected]);
      assert.equal(s.processes.length, 1, 'no Claude started by the app itself');
      assert.equal(await s.view(id), undefined, 'the old session is closed');
      terminals._reset();
    }
    const s = scenario(t), id = await s.start();
    s.choices.push(way === 'Start again' ? 2 : 3);
    assert.equal((await call(s.pilot, id)).cancelled, true);
    assert.deepEqual(s.commands.filter(c => c.startsWith('apply ')), []);
    assert.ok(await s.view(id), 'cancel keeps the session');
  });
}
