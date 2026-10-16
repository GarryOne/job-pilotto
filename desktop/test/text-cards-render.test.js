// The cards really render (renderer/pages/text-cards.js), run in Node on a tiny fake DOM, for each text: editable cards have fields and Remove; read-only cards (Notion) have the same sections and cards with no Remove and only read-only fields.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

class Node_ {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.listeners = {}; this.dataset = {}; this.className = ''; this.value = ''; }
  append(...items) { for (const item of items) this.children.push(typeof item === 'string' ? {text: item} : item); }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  setAttribute() {}
  set textContent(text) { this.children = [{text: String(text)}]; }
  get textContent() { return this.children.map(c => (c.text !== undefined ? c.text : c.textContent)).join(''); }
  all(test) { return this.children.flatMap(c => (c instanceof Node_ ? [...(test(c) ? [c] : []), ...c.all(test)] : [])); }
}
globalThis.Node = Node_;
globalThis.document = {body: new Node_('body'), addEventListener() {}, createElement: tag => new Node_(tag), createElementNS: (_, tag) => new Node_(tag)};
const {cardsEditor} = await import('../renderer/pages/text-cards.js');
const demo = file => fs.readFileSync(new URL(`../demo/${file}`, import.meta.url), 'utf8');
const TEXTS = {profile: 'profile.md', answers: 'answers.md', knowledge: 'knowledge.md'};
const by = (editor, tag, text) => editor.node.all(c => c.tagName === tag && (!text || c.textContent === text));

test('each text: editable cards have a field and a Remove per line; read-only cards have the same cards, no Remove, read-only fields', () => {
  for (const [name, file] of Object.entries(TEXTS)) {
    const text = demo(file);
    const open = cardsEditor(name, text, () => {}), shut = cardsEditor(name, text, () => {}, {readOnly: true});
    const cards = c => c.className.split(' ').includes('text-card');
    assert.ok(open.node.all(cards).length >= 4, name);
    assert.equal(shut.node.all(cards).length, open.node.all(cards).length, name);
    assert.deepEqual(by(shut, 'H4').map(h => h.textContent), by(open, 'H4').map(h => h.textContent), name);
    assert.equal(by(open, 'BUTTON', 'Remove').length, open.node.all(cards).length, name);
    assert.equal(by(shut, 'BUTTON').length, 0, `${name}: no Remove on a read-only text`);
    assert.ok(by(shut, 'TEXTAREA').length > 0 && by(shut, 'TEXTAREA').every(t => t.readOnly), name);
    assert.equal(shut.canAdd, false, name);
    assert.equal(shut.text(), text, `${name}: reading changes nothing`);
  }
});
