// The fill types a box again, once, when a page's own autofill emptied it after the upload; never a box the person touched or the page filled (tools/browser-form-fastpath.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function page() {
  class HTMLInputElement {
    constructor(id, type = 'text') {
      this.id = id; this.name = id; this.type = type; this.tagName = 'INPUT'; this.labels = []; this.disabled = false; this.readOnly = false;
      this.isConnected = true; this.listeners = [];
    }
    getClientRects() { return [1]; }
    getAttribute() { return null; }
    matches(selector) { return selector.includes(`input[type="${this.type}"]`); }
    addEventListener(type, fn) { if (type === 'input') this.listeners.push(fn); }
    dispatchEvent() {}
    focus() {}
    blur() {}
  }
  Object.defineProperty(HTMLInputElement.prototype, 'value', {get() { return this._value || ''; }, set(value) { this._value = value; }});
  class HTMLTextAreaElement {}
  const boxes = ['first', 'last', 'link', 'mail'].map(id => new HTMLInputElement(id));
  const window = {__jobPilottoGuardActive: true};
  const code = fs.readFileSync(new URL('../../tools/browser-form-fastpath.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, {window, document: {querySelectorAll: () => boxes}, HTMLInputElement, HTMLTextAreaElement,
    getComputedStyle: () => ({visibility: 'visible'}), Event: class {}, setInterval: () => 1, clearInterval() {}});
  window.__jobPilottoFillKnownFields(boxes.map(box => ({field: box.id, value: `typed-${box.id}`})));
  return {window, boxes};
}

test('a box the page emptied after the fill is typed again, once', () => {
  const {window, boxes} = page();
  boxes[0]._value = ''; boxes[1]._value = '';
  assert.equal(window.__jobPilottoRetypeWiped(), 2);
  assert.deepEqual(boxes.map(box => box.value), ['typed-first', 'typed-last', 'typed-link', 'typed-mail']);
  boxes[0]._value = '';
  assert.equal(window.__jobPilottoRetypeWiped(), 0, 'a second time is the page winning: left empty');
  assert.equal(boxes[0].value, '');
});

test('a box the person touched, or the page filled itself, is never typed over', () => {
  const {window, boxes} = page();
  boxes[0]._value = ''; boxes[0].listeners.forEach(fn => fn({isTrusted: true}));   // the person cleared it
  boxes[1]._value = 'the page wrote this';
  boxes[2]._value = ''; boxes[2].listeners.forEach(fn => fn({isTrusted: false}));   // a script's event is not the person
  assert.equal(window.__jobPilottoRetypeWiped(), 1);
  assert.equal(boxes[0].value, '');
  assert.equal(boxes[1].value, 'the page wrote this');
  assert.equal(boxes[2].value, 'typed-link');
});
