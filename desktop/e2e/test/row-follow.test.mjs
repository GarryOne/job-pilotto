// lib/row-follow.mjs: a row replay follows the live run's states after each press it makes the same way, and stops with a finding at the first different press.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {keptPresses, laterStates, replayPresses, samePress, stateAfter} from '../lib/row-follow.mjs';

const log = entries => ({route: '/extension/log', body: JSON.stringify({entries})});

test('the replay\'s presses are read from its own log calls, in order, with their labels', () => {
  const requests = [log([{text: 'fill: closed a popup', fields: {label: 'Ok'}}, {text: 'page kind: posting', fields: {}}]),
    {route: '/extension/page-kind', body: '{}'}, log([{text: 'fill: pressed the Apply button', fields: {label: 'Easy apply'}}]), {route: '/extension/log', body: '{"entries":[{"te'}];
  assert.deepEqual(replayPresses(requests), [{what: 'closed a popup', label: 'Ok'}, {what: 'pressed the Apply button', label: 'Easy apply'}]);
});

test('after press k the state is the first one kept after it and before the next press; none, the page stayed', () => {
  const states = [{at: 10, url: 'a', state: 0}, {at: 25, url: 'a', state: 1}, {at: 40, url: 'b', state: 0}];
  const presses = [{at: 20, what: 'pressed the Apply button', label: 'Easy apply'}, {at: 30, what: 'pressed the start route', label: 'Continue'}];
  assert.equal(stateAfter(states, presses, 0).state, 1);
  assert.equal(stateAfter(states, presses, 1).url, 'b');
  assert.equal(stateAfter(states, [{at: 50}], 0), null);
  assert.equal(stateAfter(states, presses, 5), null);
});

test('the same press follows; a different one is the finding, with both labels', () => {
  const live = {what: 'pressed the Apply button', label: 'Easy apply'};
  assert.deepEqual(samePress({...live}, live, 0), {same: true});
  assert.match(samePress({what: 'pressed the Apply button', label: 'Share'}, live, 0).finding, /press 1: pressed "Share".*live pressed "Easy apply"/);
  assert.match(samePress({what: 'closed a popup', label: 'Ok'}, undefined, 2).finding, /live run pressed nothing more/);
});

test('side by side, a row reads only its own presses (by host); a press line that names no host is kept', () => {
  const requests = [log([{text: 'fill: pressed the Apply button', fields: {label: 'Apply', host: 'a.example'}}, {text: 'fill: pressed the Apply button', fields: {label: 'Easy apply', host: 'b.example'}},
    {text: 'fill: closed a popup', fields: {label: 'Ok'}}])];
  assert.deepEqual(replayPresses(requests, new Set(['a.example'])).map(press => press.label), ['Apply', 'Ok']);
  assert.equal(replayPresses(requests).length, 3);
});

test('after a press, the state kept at the extension\'s ask wins over one kept earlier as the page settled', () => {
  const states = [{at: 25, url: 'b', state: 0}, {at: 27, url: 'b', state: 1, ask: true}];
  assert.equal(stateAfter(states, [{at: 20}], 0).ask, true);
  assert.equal(stateAfter([{at: 25, url: 'b', state: 0}], [{at: 20}], 0).state, 0, 'no ask state: the first one after the press');
});

test('states the page reached on its own after the first one (the extension attached the CV, the site autofilled) follow, one per extension action, even with 0 presses', () => {
  const states = [{at: 10, url: 'a', state: 0, ask: true, html: 'form'}, {at: 14, url: 'a', state: 1, html: 'filled'}, {at: 18, url: 'a', state: 2, html: 'filled'}];
  assert.equal(stateAfter(states, [], -1).state, 0, 'before any press the page starts as the extension saw it');
  assert.deepEqual(laterStates(states, [], -1).map(state => state.state), [1], 'a copy of the same page is not a new state');
  const changed = [...states.slice(0, 2), {at: 18, url: 'a', state: 2, html: 'submitted look'}];
  assert.deepEqual(laterStates(changed, [], -1).map(state => state.state), [1, 2]);
  const pressed = [{at: 12, what: 'pressed the Apply button', label: 'Go'}];
  assert.deepEqual(laterStates(changed, pressed, -1), [], 'before the first press, only the states that came before it');
  assert.deepEqual(laterStates(changed, pressed, 0).map(state => state.state), [2], 'after press 0: stateAfter serves state 1, state 2 follows');
  assert.deepEqual(laterStates(states, [{at: 50}], 0), [], 'a press with nothing after it: nothing follows');
});

test('a popup the live run closed BEFORE its first kept page (the cookie banner: the capture\'s first page is the one after it) is not a press the replay can make: dropped; later presses and other kinds stay', () => {
  const presses = [{at: 5, what: 'closed a popup', label: 'Decline all non-necessary cookies'}, {at: 6, what: 'pressed the Apply button', label: 'Apply'}, {at: 20, what: 'closed a popup', label: 'Ok'}];
  assert.deepEqual(keptPresses(presses, 10).map(press => press.what), ['pressed the Apply button', 'closed a popup']);
  assert.deepEqual(keptPresses(presses, 3).map(press => press.label), ['Decline all non-necessary cookies', 'Apply', 'Ok'], 'a popup after the first page is kept');
  assert.deepEqual(keptPresses(presses, null), presses, 'no first page time: nothing dropped');
  assert.deepEqual(keptPresses([{at: 5, what: 'closed a popup', label: 'A'}, {at: 6, what: 'closed a popup', label: 'B'}], 10), [], 'several leading popups all go');
});
