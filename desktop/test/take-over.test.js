// The app's side of the panel's "Let Claude finish this page" (lib/ladder/rung5-takeover.js): one takeover per application, the panel's Continue is the consent, a failed start gives the claim back.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createTakeOver} from '../lib/ladder/rung5-takeover.js';

function setup(results = [{ok: true, session: {id: 'c1'}}]) {
  const started = [], logs = [], windows = [], settings = {};
  const takeOver = createTakeOver({startClaude: async (url, details) => { started.push([url, details]); return results[Math.min(started.length - 1, results.length - 1)]; },
    storage: {settings: () => settings, saveSettings: patch => Object.assign(settings, patch)}, appLog: (area, text) => logs.push(text), toWindow: (...args) => windows.push(args)});
  return {takeOver, started, logs, windows, settings};
}
const URL1 = 'https://www.jobs.ch/en/vacancies/detail/manor/';

test('a second takeover for the same application is refused and logged, whatever page or press asks', async () => {
  const s = setup();
  assert.equal((await s.takeOver({url: URL1, host: 'a'})).ok, true);
  assert.equal((await s.takeOver({url: `${URL1}#frag`, host: 'b'})).refused, true, 'another page of the same application');
  assert.equal((await s.takeOver({url: URL1.toUpperCase().replace(/\/$/, ''), host: 'c'})).refused, true, 'spelled differently');
  assert.equal(s.started.length, 1);
  assert.equal(s.logs.filter(line => /refused: Claude already took over/.test(line)).length, 2);
  assert.ok(s.windows.some(([kind, body]) => kind === 'toast' && /already worked/.test(body.title)));
  assert.equal((await s.takeOver({url: 'https://www.jobs.ch/en/vacancies/detail/other/'})).ok, true, 'another application is its own');
});

test('a start that failed gives the claim back; "Continue" in the panel is the consent', async () => {
  const s = setup([{ok: false, error: 'no'}, {ok: true, session: {id: 'c2'}}]);
  assert.equal((await s.takeOver({url: URL1, consent: true})).ok, false);
  assert.ok(s.settings.claudeConsent, 'the consent is kept');
  assert.equal((await s.takeOver({url: URL1})).ok, true, 'asked again after a failed start');
  assert.equal(s.started.length, 2);
});

test('a started takeover begins a teaching run on that application (lib/ladder/rung5-takeover-teach.js); a refused or failed one does not', async () => {
  const runs = [];
  const make = results => { const s = setup(results); return {...s, takeOver: createTakeOver({startClaude: async () => results[0], storage: {settings: () => ({}), saveSettings() {}}, appLog() {}, toWindow() {}, onStarted: url => runs.push(url)})}; };
  await make([{ok: true, session: {id: 'c1'}}]).takeOver({url: URL1});
  await make([{ok: false, error: 'no'}]).takeOver({url: 'https://x.example/1'});
  assert.deepEqual(runs, [URL1]);
});
