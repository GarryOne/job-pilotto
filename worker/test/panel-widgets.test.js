// The panel (extension/review.js) counts a REQUIRED custom control it cannot read (a slider, a switch, a rich-text box) as left for the person, until the control's own
// state changes: it used to say "Ready to submit" over an unanswered question (found by the apply end-to-end suite, 2 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage } from './helpers/page.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const JSDOM = await loadJsdom();

const FORM = (widget) => `<form>
  <label for="a">First name *</label><input id="a" required value="Ada">
  <label for="b">Last name *</label><input id="b" required value="Tester">
  <label for="c">Email *</label><input id="c" type="email" required value="ada@example.test">
  ${widget}</form>`;
const SLIDER = '<div id="lbl">How would you rate your Terraform skill? *</div><div role="slider" id="skill" aria-labelledby="lbl" aria-required="true" aria-valuenow="1" tabindex="0"></div>';

async function panel(html, after) {
  const { window } = openPage(JSDOM, html);
  window.chrome = { runtime: { id: 'test', sendMessage: async (message) => (message.type === 'panelAllowed' ? { ok: true } : {}), onMessage: { addListener() {} } } };
  window.eval(read('extension/page/skeleton.js'));
  window.eval(read('extension/review.js'));
  await new Promise((resolve) => setTimeout(resolve, 50));
  const read2 = () => {
    const root = window.document.getElementById('jobpilotto-review-host')?.shadowRoot;
    return root && { pill: root.querySelector('.pill b').textContent, ring: root.querySelector('.ring span').textContent };
  };
  const before = read2();
  if (after) { after(window.document); await new Promise((resolve) => setTimeout(resolve, 3500)); }   // the panel re-reads the page every few seconds
  const result = { before, after: after ? read2() : null };
  window.close();   // stops the panel's polling: the test run can end
  return result;
}

test('a required slider nobody has touched is one left: the panel is not "Ready to submit"', { skip: !JSDOM }, async () => {
  const { before } = await panel(FORM(SLIDER));
  assert.equal(before.pill, '1 left');
});

test('the same form without the slider is "Ready to submit" (the check is about the slider, not the panel)', { skip: !JSDOM }, async () => {
  const { before } = await panel(FORM(''));
  assert.equal(before.pill, 'Ready to submit');
});

test('an optional slider is not counted', { skip: !JSDOM }, async () => {
  const { before } = await panel(FORM(SLIDER.replace('aria-required="true"', '').replace(' *</div>', '</div>')));
  assert.equal(before.pill, 'Ready to submit');
});

test('once the person moves the slider it counts as answered', { skip: !JSDOM }, async () => {
  const { before, after } = await panel(FORM(SLIDER), (doc) => doc.getElementById('skill').setAttribute('aria-valuenow', '4'));
  assert.equal(before.pill, '1 left');
  assert.equal(after.pill, 'Ready to submit');
});

// Ashby titles a radio group with a <label> inside the <fieldset> and marks it required only by a CSS "*" (class _required_):
// the panel listed neither of two such questions (Colonist, 5 Oct 2026).
const ASHBY_RADIOS = `<fieldset><label class="_heading _required_f7cvd_91" for="nowhere">How much has AI increased your speed?</label>
  <div><input type="radio" id="r0" name="speed"><label for="r0">20%</label></div>
  <div><input type="radio" id="r1" name="speed"><label for="r1">2x</label></div></fieldset>`;

test('a required Ashby radio group (titled by a label, "*" drawn by CSS) is one left until answered', { skip: !JSDOM }, async () => {
  const { before, after } = await panel(FORM(ASHBY_RADIOS), (document) => document.getElementById('r1').click());
  assert.equal(before.pill, '1 left');
  assert.equal(after.pill, 'Ready to submit');
});
