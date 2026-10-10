// The extension's climb (extension/ladder.js): what it does with a rung's signal, using the router (extension/ladder-core.js). Fake `ask`, no browser.
import assert from 'node:assert/strict';
import test from 'node:test';
import {climbOnStall, climbOnUnsure, forgetClimb, noteSignal, toldReport} from '../../extension/ladder.js';

const digestAnswer = {role: 'no-form', kind: 'posting', by: 'digest', rung: 3, signal: 'confident', digest: {outcome: 'phone', verb: 'tell_person', numbers: [2], chosen: [{n: 2, kind: 'sentence', text: 'Call us: 044 555 01 00'}]}};

test('an unsure page-kind answer climbs to the digest: one more ask, with digest set; a confident one never climbs', async () => {
  const asked = [];
  const ask = async (tab, options) => { asked.push(options); return digestAnswer; };
  noteSignal(7, {rung: 2, signal: 'unsure'});
  assert.equal(await climbOnUnsure({id: 7}, ask), digestAnswer);
  assert.deepEqual(asked, [{digest: true}]);
  noteSignal(8, {rung: 2, signal: 'confident'});
  assert.equal(await climbOnUnsure({id: 8}, ask), null);
  assert.equal(await climbOnUnsure({id: 99}, ask), null, 'no signal noted: nothing to climb');
  assert.equal(asked.length, 1);
});

test('the digest is asked once per tab and page when a page without a form stalls, and never when the answer already came from the digest', async () => {
  forgetClimb(5);
  let calls = 0;
  const ask = async () => { calls += 1; return digestAnswer; };
  assert.equal(await climbOnStall({id: 5}, ask, '5 jobs.example/x', {by: 'ai'}), digestAnswer);
  assert.equal(await climbOnStall({id: 5}, ask, '5 jobs.example/x', {by: 'ai'}), null, 'once per tab and page');
  assert.equal(await climbOnStall({id: 5}, ask, '5 jobs.example/y', {by: 'digest'}), null, 'the digest already answered');
  assert.equal(calls, 1);
  forgetClimb(5);
  assert.equal(await climbOnStall({id: 5}, ask, '5 jobs.example/x', {by: 'ai'}), digestAnswer, 'a reload or a new tab may look again');
});

test('only a tell_person answer is reported as told, with the page\'s own sentence (an email has its own report)', () => {
  assert.deepEqual(toldReport({digest: {verb: 'tell_person', outcome: 'phone', chosen: [{text: 'Call us: 044 555 01 00'}]}}), {why: 'told', needs: 'Call us: 044 555 01 00'});
  for (const kind of [null, {}, {digest: {verb: 'press', outcome: 'form', chosen: [{text: 'Apply'}]}}, {digest: {verb: 'none', outcome: 'other', chosen: []}}, {digest: {verb: 'tell_person', outcome: 'email', chosen: [{text: 'a@example.com'}]}}]) assert.equal(toldReport(kind), null);
});

test('what the app is told when a digest-named press led to a form: fixed values only, never a sentence, never an address', async () => {
  const {verifiedBody} = await import('../../extension/ladder.js');
  const kind = {by: 'digest', rung: 3, digest: {outcome: 'form', verb: 'press', chosen: [{n: 2, kind: 'button', text: 'Postuler'}]}};
  assert.deepEqual(verifiedBody(kind, 'https://jobs.example/x?token=secret#frag', [{type: 'text'}]), {verified: true, url: 'https://jobs.example/x', controls: [{type: 'text'}], rung: 3, outcome: 'form', kind: 'posting', signal: 'confident'});
  for (const nope of [null, {}, {by: 'ai', rung: 2, digest: {outcome: 'form'}}, {by: 'digest', rung: 3}]) assert.equal(verifiedBody(nope, 'https://jobs.example/x', []), null, 'only a digest answer is reported');
  assert.equal(JSON.stringify(verifiedBody(kind, 'https://jobs.example/x', [])).includes('Postuler'), false);
});

test('when the ladder ends with no usable answer (the digest answered nothing, or said other with nothing to tell), the page is reported as other, never silently', async () => {
  const {climbOnStall, climbOnUnsure, forgetClimb, noteSignal, otherReport} = await import('../../extension/ladder.js');
  forgetClimb(11);
  noteSignal(11, {rung: 2, signal: 'unsure'});
  await climbOnUnsure({id: 11}, async () => null);   // the digest was unsure or failed: no answer
  assert.deepEqual(otherReport({by: 'ai'}, 11), {why: 'other', needs: ''});
  forgetClimb(12);
  assert.deepEqual(otherReport({by: 'digest', applyButton: '', digest: {outcome: 'other', verb: 'none', chosen: []}}, 12), {why: 'other', needs: ''}, 'the digest said other');
  assert.equal(otherReport({by: 'digest', applyButton: 'postuler', digest: {outcome: 'form', verb: 'press', chosen: [{text: 'Postuler'}]}}, 12), null, 'a button to press is an answer');
  assert.equal(otherReport({by: 'digest', digest: {outcome: 'phone', verb: 'tell_person', chosen: [{text: 'Call'}]}}, 12), null, 'a sentence to tell is an answer');
  assert.equal(otherReport({by: 'ai'}, 13), null, 'the digest was never asked: nothing to report as other');
  forgetClimb(14);
  assert.equal(await climbOnStall({id: 14}, async () => null, '14 x', {by: 'ai'}), null);
  assert.deepEqual(otherReport({by: 'ai'}, 14), {why: 'other', needs: ''}, 'a stall whose digest answered nothing');
});

test('the extension keeps each frame candidate\'s address for itself and sends only host, path and size; the index the app answers opens the stored address, https only', async () => {
  const {frameSketch, frameSrcOf, forgetClimb, noteFrames} = await import('../../extension/ladder.js');
  forgetClimb(21);
  const list = [{host: 'job-boards.example-ats.io', path: '/embed/job_app', src: 'https://job-boards.example-ats.io/embed/job_app?token=secret', width: 650, height: 2432}, {host: 'x.example', path: '/a', src: 'http://x.example/a', width: 400, height: 300}];
  noteFrames(21, list);
  assert.deepEqual(frameSketch(list), [{host: 'job-boards.example-ats.io', path: '/embed/job_app', width: 650, height: 2432}, {host: 'x.example', path: '/a', width: 400, height: 300}]);
  assert.equal(JSON.stringify(frameSketch(list)).includes('secret'), false);
  assert.equal(frameSrcOf(21, 0), 'https://job-boards.example-ats.io/embed/job_app?token=secret');
  assert.equal(frameSrcOf(21, 1), '', 'never an http address');
  for (const bad of [2, -1, 0.5, undefined, 'a']) assert.equal(frameSrcOf(21, bad), '');
  assert.equal(frameSrcOf(99, 0), '', 'a tab with no frames noted');
});
