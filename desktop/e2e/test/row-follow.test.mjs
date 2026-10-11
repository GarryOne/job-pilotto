/* global window, document */
// lib/row-follow.mjs: a row replay follows the live run's states after each press it makes the same way, and stops with a finding at the first different press.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bindToAsks, followDelayMs, keptPresses, laterStates, replayPresses, samePress, stateAfter} from '../lib/row-follow.mjs';

const log = entries => ({route: '/extension/log', body: JSON.stringify({entries})});

test('the replay\'s presses are read from its own log calls, in order, with their labels', () => {
  const requests = [log([{text: 'fill: closed a popup', fields: {label: 'Ok'}}, {text: 'page kind: posting', fields: {}}]),
    {route: '/extension/page-kind', body: '{}'}, log([{text: 'fill: pressed the Apply button', fields: {label: 'Easy apply'}}]), {route: '/extension/log', body: '{"entries":[{"te'}];
  assert.deepEqual(replayPresses(requests), [{what: 'pressed the Apply button', label: 'Easy apply'}], 'a popup close is no press of the journey');
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
  assert.deepEqual(replayPresses(requests, new Set(['a.example'])).map(press => press.label), ['Apply']);
  assert.equal(replayPresses(requests).length, 2);
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

test('a popup close is in neither list: not the live run\'s (before or after its first page, one or several) and not the replay\'s (Lever keeps the banner in every state, Teamtailor has none)', () => {
  const presses = [{at: 5, what: 'closed a popup', label: 'Decline all non-necessary cookies'}, {at: 6, what: 'pressed the Apply button', label: 'Apply'}, {at: 20, what: 'closed a popup', label: 'Ok'}];
  assert.deepEqual(keptPresses(presses, 10).map(press => press.what), ['pressed the Apply button']);
  assert.deepEqual(keptPresses(presses, 3).map(press => press.label), ['Apply'], 'a popup after the first page goes too');
  assert.deepEqual(keptPresses(presses, null).map(press => press.label), ['Apply']);
  const log = entries => [{route: '/extension/log', body: JSON.stringify({entries})}];
  assert.deepEqual(replayPresses(log([{text: 'closed a popup: deny', fields: {label: 'deny'}}, {text: 'pressed the Apply button: Apply', fields: {label: 'Apply'}}])).map(press => press.label), ['Apply'], 'the replay\'s popup close is left out');
});

test('the page follows an attach after the gap the live run had between its two states, within 150 ms and 8 s, so the extension\'s first ask sees the page the live ask saw', () => {
  assert.equal(followDelayMs({at: 1000}, {at: 3600}), 2600);
  assert.equal(followDelayMs({at: 1000}, {at: 1020}), 150, 'never faster than the site\'s own reaction');
  assert.equal(followDelayMs({at: 1000}, {at: 91000}), 8000, 'a long gap (a slow page) is capped');
  assert.equal(followDelayMs(undefined, {at: 5}), 150, 'no earlier state: the default');
});

// swapInPage runs in a page: the same element keeps its identity (the extension holds it) while a later live state is played into it.
let chromium = null;
try { ({chromium} = await import('playwright-core')); if (!(await import('node:fs')).existsSync(chromium.executablePath())) chromium = null; } catch { /* no playwright */ }
test('a later live state is played INTO the page: the box the extension typed in is the same element, its value emptied as the page\'s own script did; new text and new nodes arrive; the extension\'s UI stays', {skip: !chromium && 'no Chromium installed'}, async () => {
  const {swapInPage} = await import('../lib/row-follow.mjs');
  const browser = await chromium.launch({headless: true});
  try {
    const page = await (await browser.newContext()).newPage();
    await page.setContent('<html><head><title>a</title></head><body><form><label for="a">First</label><input id="a" name="first" type="text"><input id="b" type="text"><input type="file" id="f"></form><p>Upload</p><div id="jobpilotto-box">ui</div></body></html>');
    await page.evaluate(() => { window.held = document.getElementById('a'); window.held.value = 'Ada'; document.getElementById('b').value = 'Tester'; });
    await page.evaluate(swapInPage, '<html><head><title>b</title></head><body><form><label for="a">First</label><input id="a" name="first" type="text"><input id="b" type="text"><input type="file" id="f"></form><p>Autofill completed!</p><section id="more">review</section></body></html>');
    const seen = await page.evaluate(() => ({same: window.held === document.getElementById('a') && window.held.isConnected, first: window.held.value, second: document.getElementById('b').value, text: document.body.innerText, ui: !!document.getElementById('jobpilotto-box'), more: !!document.getElementById('more'), title: document.title}));
    assert.deepEqual(seen.same, true, 'the element the extension typed in is still the page\'s element');
    assert.deepEqual([seen.first, seen.second], ['', ''], 'its value emptied: the capture holds none');
    assert.match(seen.text, /Autofill completed!/);
    assert.equal(seen.more, true);
    assert.equal(seen.ui, true);
    assert.equal(seen.title, 'b');
  } finally { await browser.close(); }
});

test('a later state that followed an answered ask within 5 s is bound to it; the first later state stays the attach\'s; one far from any ask stays free', () => {
  const later = [{at: 3000, id: 'attach'}, {at: 21600, id: 'after answer'}, {at: 40000, id: 'far'}];
  const asks = [{route: '/extension/page-kind', at: 6400}, {route: '/extension/answer', at: 20600}, {route: '/extension/account-judge', at: 26700}];
  const {bound, free} = bindToAsks(later, asks);
  assert.deepEqual(bound.map(item => [item.state.id, item.route, item.n]), [['after answer', '/extension/answer', 1]]);
  assert.deepEqual(free.map(state => state.id), ['attach', 'far']);
  assert.deepEqual(bindToAsks(later, []).free.map(state => state.id), ['attach', 'after answer', 'far'], 'no asks: all stay with the attach list');
  assert.equal(bindToAsks([{at: 5000}, {at: 9000}], [{route: 'r', at: 1000}, {route: 'r', at: 8000}]).bound[0].n, 2, 'the n-th answer on that route');
});

test('the live state\'s control states are restored after the swap: a filled box keeps the typed value (or gets a stand-in), an empty one is empty, a checkbox is as it was', {skip: !chromium && 'no Chromium installed'}, async () => {
  const {swapInPage} = await import('../lib/row-follow.mjs');
  const browser = await chromium.launch({headless: true});
  try {
    const page = await (await browser.newContext()).newPage();
    await page.setContent('<html><body><input id="a" type="text"><input id="b" type="text"><input id="c" type="text"><input id="k" type="checkbox"><input id="m" type="checkbox"></body></html>');
    await page.evaluate(() => { document.getElementById('a').value = 'Ada'; document.getElementById('b').value = 'typed'; document.getElementById('m').checked = true; });
    await page.evaluate(swapInPage, '<html><body><input id="a" type="text" data-jp-state="filled"><input id="b" type="text" data-jp-state="empty"><input id="c" type="text" data-jp-state="filled"><input id="k" type="checkbox" data-jp-state="checked"><input id="m" type="checkbox" data-jp-state="unchecked"></body></html>');
    const seen = await page.evaluate(() => ({a: document.getElementById('a').value, b: document.getElementById('b').value, c: document.getElementById('c').value, k: document.getElementById('k').checked, m: document.getElementById('m').checked}));
    assert.deepEqual(seen, {a: 'Ada', b: '', c: 'x', k: true, m: false});
  } finally { await browser.close(); }
});
