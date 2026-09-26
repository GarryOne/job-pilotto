import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('fast path fills only safe known fields and reports gaps without values', () => {
  class HTMLInputElement {
    constructor(id, type = 'text') {
      this.id = id; this.name = id; this.type = type; this.tagName = 'INPUT';
      this.value = ''; this.labels = []; this.disabled = false; this.readOnly = false;
    }
    getClientRects() { return [1]; }
    getAttribute() { return null; }
    matches(selector) { return selector.includes(`input[type="${this.type}"]`) ||
      (this.type === 'text' && selector.includes('input[type="text"]')); }
    dispatchEvent() {}
  }
  Object.defineProperty(HTMLInputElement.prototype, 'value', {
    get() { return this._value || ''; }, set(value) { this._value = value; },
  });
  class HTMLTextAreaElement {}
  const email = new HTMLInputElement('email', 'email');
  const legal = new HTMLInputElement('privacy_consent', 'checkbox');
  legal.labels = [{textContent: 'I agree to privacy terms'}];
  const submit = new HTMLInputElement('submit', 'submit');
  const elements = [email, legal, submit];
  const document = {querySelectorAll() { return elements; }};
  const window = {__jobPilottoGuardActive: true};
  const code = fs.readFileSync(new URL('../../tools/browser-form-fastpath.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, {window, document, HTMLInputElement, HTMLTextAreaElement,
    getComputedStyle: () => ({visibility: 'visible'}), Event: class {}});
  const outcome = window.__jobPilottoFillKnownFields([
    {field: 'email', value: 'sample@example.test'},
    {field: 'privacy_consent', value: 'yes'},
    {field: 'submit', value: 'clicked'},
    {field: 'unknown', value: 'anything'},
  ]);
  assert.deepEqual(Array.from(outcome.filled), ['email']);
  assert.equal(email.value, 'sample@example.test');
  assert.equal(legal.value, '');
  assert.equal(submit.value, '');
  const audited = window.__jobPilottoAuditVisibleFields();
  assert.equal(audited.length, 2);
  assert.equal(audited[0].filled, true);
  assert.equal(audited[1].legal, true);
  assert.equal(JSON.stringify(outcome).includes('sample@example.test'), false);
});

test('option picker needs an exact match, so "Male" never picks "Female"', () => {
  const clicked = [];
  const option = text => ({textContent: text, offsetParent: {}, children: [],
    getBoundingClientRect: () => ({x: 0, y: 0, width: 10, height: 10}), click() { clicked.push(text); }});
  const options = [option('Female'), option('Male'), option('Decline To Self Identify')];
  const document = {querySelectorAll: selector => (selector.includes('option') ? options : [])};
  const window = {__jobPilottoGuardActive: true};
  const code = fs.readFileSync(new URL('../../tools/browser-form-fastpath.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, {window, document, HTMLInputElement: class {}, HTMLTextAreaElement: class {},
    getComputedStyle: () => ({visibility: 'visible'}), Event: class {}, innerHeight: 800});
  assert.equal(window.__jobPilottoClickOption('male').ok, true);
  assert.deepEqual(clicked, ['Male']);
  const missing = window.__jobPilottoClickOption('Other');
  assert.equal(missing.ok, false);
  assert.equal(missing.why, 'no exact match');
});
