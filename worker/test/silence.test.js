// The silent dead-end rule (extension/ladder/silence.js; spec 2026-10-12-one-next-move.md phase 2 box 2): no progress for T on an application whose run has not ended is noted once,
// in shadow, at the door; per application, not per tab; ended by the door or by a page handed to the person; restarted by progress notes only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {SILENT_AFTER_MS, askEnded, askStarted, askTime, checkSilence, endSilence, forgetSilence, handedToPerson, isSilent, restartSilence, silenceOf, silenceTab, useSilence} from '../../extension/ladder/silence.js';

const T = SILENT_AFTER_MS, fired = [], timers = [];
useSilence({notice: (host, evidence) => fired.push({host, evidence}), timer: (fn, ms) => timers.push({fn, ms, cancelled: false}), cancel: id => { timers[id - 1].cancelled = true; }});

test('the rule: silent when nothing ended the clock, it was not noted yet, and its last progress is T old', () => {
  const clock = {at: 1000, ended: false, noticed: false};
  assert.equal(isSilent(clock, 1000 + T), true);
  assert.equal(isSilent(clock, 1000 + T - 1), false);
  assert.equal(isSilent({...clock, ended: true}, 1000 + 10 * T), false, 'the run ended: silence is expected');
  assert.equal(isSilent({...clock, noticed: true}, 1000 + 10 * T), false, 'noted once per silence');
  assert.equal(isSilent(null, T), false);
  assert.ok(T >= 20000, 'T sits above the normal waits measured on the CI pool');
});

test('a page is handed to the person when the form judge says their choice is needed, or the form is ready on its final step; never on a middle step, a block or unsure', () => {
  assert.equal(handedToPerson({answer: 'needs_person', step: 'final'}), true);
  assert.equal(handedToPerson({answer: 'ready', step: 'final'}), true);
  for (const answer of [{answer: 'ready', step: 'middle'}, {answer: 'blocked', step: 'final'}, {answer: 'unsure', step: 'final'}, {answer: 'ready', step: 'unsure'}, null]) assert.equal(handedToPerson(answer), false, JSON.stringify(answer));
});

test('no progress for T: noted once, with the last kind, how long, and the page\'s host; a new note starts the clock again and cancels the old check', () => {
  fired.length = 0;
  silenceTab(1, 'https://jobs.example/1#apply');
  restartSilence(1, 'navigated', {now: 1000, host: 'jobs.example'});
  assert.equal(timers.at(-1).ms, T, 'checked T after the note');
  assert.equal(checkSilence(1, 1000 + T - 1), false);
  assert.equal(checkSilence(1, 1000 + T), true);
  assert.equal(checkSilence(1, 1000 + T + 5000), false, 'once per silence');
  assert.deepEqual(fired, [{host: 'jobs.example', evidence: {kind: 'navigated', silentMs: T}}]);
  const before = timers.length;
  restartSilence(1, 'required_down', {now: 50000});
  assert.equal(timers[before - 1].cancelled, true);
  assert.equal(checkSilence(1, 50000 + T), true);
  assert.deepEqual(fired[1], {host: 'jobs.example', evidence: {kind: 'required_down', silentMs: T}}, 'a note that knows no page keeps the last host');
});

test('per application: a note in the form tab keeps the posting tab\'s application alive; a closed tab leaves the clock to the other', () => {
  silenceTab(2, 'https://jobs.example/2');
  silenceTab(3, 'https://jobs.example/2#form');
  restartSilence(2, 'navigated', {now: 0, host: 'jobs.example'});
  restartSilence(3, 'navigated', {now: 20000, host: 'apply.example'});
  assert.equal(checkSilence(2, T), false, 'the application moved on in another tab');
  assert.deepEqual(silenceOf(2), silenceOf(3));
  forgetSilence(2);
  assert.equal(silenceOf(3)?.host, 'apply.example', 'the other tab keeps the clock');
  forgetSilence(3);
  assert.equal(silenceOf(3), null);
});

test('a run that ended is never silent (the door spoke, or the page was handed to the person); a new page starts it again', () => {
  fired.length = 0;
  silenceTab(4, 'https://jobs.example/4');
  restartSilence(4, 'navigated', {now: 0});
  endSilence(4);
  assert.equal(timers.at(-1).cancelled, true);
  assert.equal(checkSilence(4, 10 * T), false);
  restartSilence(4, 'navigated', {now: 100});
  assert.equal(silenceOf(4).ended, false);
  assert.deepEqual(fired, []);
});

test('wired where the spec says: every progress note restarts it, a new page names its application, the door and a handed page end it, the notice goes through the door', () => {
  const read = file => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8');
  const progress = read('ladder/progress.js');
  assert.match(progress, /log\('fill', `progress: \$\{kind\}`[^\n]*\n\s*restartSilence\(tabId, kind, \{now, host\}\);/, 'every note, right where it is logged');
  assert.match(progress, /silenceTab\(tabId, where\.job\)/);
  assert.match(progress, /useSilence\(\{notice: \(host, evidence\) => seenDeadEnd\('silent', host, evidence, log\)\}\)/);
  assert.match(progress, /forgetSilence\(tabId\)/);
  assert.match(read('ladder/dead-end.js'), /export function deadEnd\([\s\S]*?endSilence\(stop\.tabId\);[\s\S]*?const sent = report\(/, 'the door ends it, for every stop');
  assert.match(read('form-ready.js'), /if \(handedToPerson\(answer\)\) endSilence\(tab\.id\);/);
  assert.match(read('fill-flow.js'), /notePage\(tab\.id, key, \{job: jobUrl \|\| tab\.url, page: tab\.url\}\)/);
  assert.doesNotMatch(read('fill-flow.js'), /restartSilence|endSilence/, 'the flow never touches the clock but through a note or the door');
});

test('an ask to the app in flight is a wait, not a stall: the clock stands still, and the notice comes T of quiet later', () => {
  fired.length = 0;
  silenceTab(5, 'https://jobs.example/5');
  restartSilence(5, 'navigated', {now: 100000, host: 'jobs.example'});
  askStarted(110000);   // the fill asks the app for 15 answers: 40 s
  assert.equal(checkSilence(5, 100000 + T), false, 'T after the note, but an ask is out: not silent');
  assert.equal(timers.at(-1).ms, 20000, 'looked at again when the rest of T would be up (10 s were quiet before the ask)');
  askEnded(150000);
  assert.equal(askTime(150000), 40000);
  assert.equal(checkSilence(5, 150000 + T - 10000 - 1), false, '30 s of quiet are not there yet: 10 s before the ask, 19.999 s after it');
  assert.equal(checkSilence(5, 150000 + T - 10000), true, 'T of quiet, the ask excluded');
  assert.deepEqual(fired, [{host: 'jobs.example', evidence: {kind: 'navigated', silentMs: T}}], 'the notice names the quiet time, not the wall time');
  assert.equal(isSilent({at: 0, ended: false, noticed: false}, T), true, 'the offline measurement\'s plain clocks keep their meaning');
});

test('class: every call to the app is bracketed as an ask (flow.js api), whatever the call', () => {
  const flow = fs.readFileSync(new URL('../../extension/flow.js', import.meta.url), 'utf8');
  assert.match(flow, /export async function api\(config, path, init = \{\}, retry = true\) \{\s*askStarted\(\);[^\n]*\n\s*try \{ return await apiCall\(config, path, init, retry\); \} finally \{ askEnded\(\); \}/);
  assert.match(flow, /return apiCall\(Object\.assign\(config, fresh\), path, init, false\)/, 'the retry after a 401 is inside the same bracket');
});
