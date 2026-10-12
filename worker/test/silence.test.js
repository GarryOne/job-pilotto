// The silent dead-end rule (extension/ladder/silence.js; spec 2026-10-12-one-next-move.md phase 2 box 2): no progress for T on an application whose run has not ended is noted once,
// in shadow, at the door; per application, not per tab; ended by the door or by a page handed to the person; restarted by progress notes only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {SILENT_AFTER_MS, checkSilence, endSilence, forgetSilence, isSilent, restartSilence, silenceOf, silenceTab, useSilence} from '../../extension/ladder/silence.js';

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
  assert.match(read('ladder/dead-end.js'), /export function deadEnd\([\s\S]*?endSilence\(stop\.tabId\);[\s\S]*?return report\(/, 'the door ends it, for every stop');
  assert.match(read('form-ready.js'), /if \(answer\.answer === 'needs_person' \|\| \(answer\.answer === 'ready' && answer\.step === 'final'\)\) endSilence\(tab\.id\);/);
  assert.match(read('fill-flow.js'), /notePage\(tab\.id, key, \{job: jobUrl \|\| tab\.url, page: tab\.url\}\)/);
  assert.doesNotMatch(read('fill-flow.js'), /restartSilence|endSilence/, 'the flow never touches the clock but through a note or the door');
});
