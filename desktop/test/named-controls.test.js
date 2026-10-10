// The control the page-kind AI names is found with the list its sketch came from (extension/tab-pages.js NAMED_BUTTONS, used by fill-flow.js pageSketchOf and the named-button
// finder), and the floors still refuse a Submit by another name. Hornbach, 10 Oct 2026: the AI named a link with no href that the finder never listed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {NAMED_BUTTONS, pickApplyButton, pickNamedButton} from '../../extension/tab-pages.js';
import {behindAStep, whyNotPressed} from '../../extension/ladder/press-why.js';

const flow = fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8');
const row = (text, extra = {}) => ({index: 0, tag: 'a', text, area: 4000, visible: true, disabled: false, href: '', submits: false, ...extra});

test('the page sketch and the named-button finder read one list, not two copies', () => {
  assert.equal(NAMED_BUTTONS, 'button, input[type=submit], [role=button], a');
  // pageSketchOf is a closed script (desktop/e2e/ladder-capture.mjs runs its body with no arguments), so its list is a literal: pinned equal to the shared one.
  const sketch = flow.slice(flow.indexOf('function pageSketchOf'));
  assert.equal(sketch.match(/const buttons = all\('([^']*)'\)/)?.[1], NAMED_BUTTONS, 'the page sketch lists what the named-button finder searches');
  assert.match(sketch.slice(0, 200), /func: \(\) => \{/, 'a closed script, no argument (the capture tool extracts it)');
  assert.match(flow, /listed = target \? NAMED_BUTTONS : PAGE_BUTTONS/, 'the named path searches the shared list');
});

test('a named control with no href is found; the floors still refuse a Submit by another name', () => {
  const named = 'Jetzt bewerben (ohne Anmeldung)';
  assert.equal(pickNamedButton([row('Jetzt bewerben (mit Anmeldung)', {href: '/login'}), row(named)], named).text, named);
  assert.equal(pickNamedButton([row(named, {submits: true})], named), null, 'a link that is a form\'s Submit');
  assert.equal(pickNamedButton([row(named, {visible: false})], named), null);
  assert.equal(pickNamedButton([row(named, {disabled: true})], named), null);
  assert.equal(pickNamedButton([row('Sign in to apply')], 'Sign in to apply'), null, 'never a sign-in');
  assert.equal(pickNamedButton([row('Apply with LinkedIn')], 'Apply with LinkedIn'), null);
  assert.equal(pickNamedButton([row(named, {href: 'mailto:a@b.c'})], named), null, 'never a mail link');
});

test('with no name, the phrase path is unchanged: an href-less link is no candidate it could press by a phrase it never saw', () => {
  assert.equal(pickApplyButton([row('Apply', {href: '/x'})], []).text, 'Apply');
  assert.equal(pickApplyButton([row('Jetzt bewerben (ohne Anmeldung)')], []), null, 'the built-in words do not match it');
});

test('a named control hidden until a step opens it lets the page\'s own Apply go first; absent or refused, nothing else is pressed', () => {
  const named = 'Apply Manually';
  const why = candidates => whyNotPressed(candidates, named);
  assert.equal(behindAStep(why([row(named, {visible: false}), row('Apply', {href: '#'})])), true, 'in the dialog the plain Apply opens (Workday)');
  assert.equal(behindAStep(why([row('Apply', {href: '#'})])), false, 'absent from the page: nothing pressed');
  assert.equal(behindAStep(why([row(named, {submits: true})])), false, 'visible but a form\'s Submit');
  assert.equal(behindAStep(why([row(named, {disabled: true})])), false, 'visible but disabled');
  assert.equal(behindAStep(why([row(named)])), false, 'visible and pressable: pickNamedButton presses it, no fallback');
  assert.equal(behindAStep(null), false);
});
