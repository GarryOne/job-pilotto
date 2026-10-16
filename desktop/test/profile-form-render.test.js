// The Preferences form really renders (renderer/pages/profile-form.js), run in Node on a tiny fake DOM: this Mac's text and the Notion outline both
// produce the sections, inputs, flags and buttons, and a change enables Save and sends only what changed. A render that throws shows here.
import assert from 'node:assert/strict';
import {test} from 'node:test';

class Node_ {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.listeners = {}; this.attrs = {}; this.dataset = {}; this.className = ''; this.hidden = false; this.value = ''; this.disabled = false; }
  append(...items) { for (const item of items) this.children.push(typeof item === 'string' ? {text: item} : item); }
  prepend(...items) { this.children.unshift(...items.map(item => (typeof item === 'string' ? {text: item} : item))); }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  insertBefore(node, ref) { const at = this.children.indexOf(ref); this.children.splice(at < 0 ? this.children.length : at, 0, node); }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  set textContent(text) { this.children = [{text: String(text)}]; }
  get textContent() { return this.children.map(c => (c.text !== undefined ? c.text : c.textContent)).join(''); }
  get classList() { return {add: () => {}, remove: () => {}, toggle: () => {}}; }
  all(test) { return this.children.flatMap(c => (c instanceof Node_ ? [...(test(c) ? [c] : []), ...c.all(test)] : [])); }
  querySelector(selector) {
    const match = selector.startsWith('.') ? c => c.className.split(' ').includes(selector.slice(1)) : c => c.tagName === selector.toUpperCase();
    return this.all(match)[0] || null;
  }
}
const body = new Node_('div'), panel = new Node_('div');
panel.className = 'panel'; body.className = 'text-editor-body'; panel.append(body);
const messages = {};
globalThis.Node = Node_;
globalThis.document = {body: new Node_('body'), addEventListener() {}, createElement: tag => new Node_(tag), createElementNS: (_, tag) => new Node_(tag), querySelector: () => panel, getElementById: id => (messages[id] ||= new Node_('p')), querySelectorAll: () => []};
globalThis.window = {pilot: {state: async () => ({}), takeNotionNeed: () => null}, addEventListener() {}, matchMedia: () => ({matches: false, addEventListener() {}})};
globalThis.localStorage = {getItem: () => null, setItem() {}};

const {loadProfileForm} = await import('../renderer/pages/profile-form.js');
const PAGE = '## Profile\n\n# Hard constraints\n\n| Constraint | Value |\n|---|---|\n| Countries | Switzerland |\n| Home base | Geneva; ❓ relocate |\n\n# Compensation\n\n- Target: CHF 150k\n\n# Summary\n\nSRE.\n';
const inputs = () => body.all(c => c.tagName === 'INPUT' && c.type !== 'search');   // the rest-of-page cards' search box is not a field
const button = text => body.all(c => c.tagName === 'BUTTON').find(b => b.textContent === text);

test('this Mac: the form renders sections and inputs; a change enables Save, which saves the whole text', async () => {
  let sent = null;
  globalThis.window.pilot = {...globalThis.window.pilot, textGet: async () => ({ok: true, editable: true, markdown: PAGE}), textSave: async (name, text) => { sent = [name, text]; return {ok: true}; }};
  await loadProfileForm();
  assert.deepEqual(body.all(c => c.tagName === 'H4').map(h => h.textContent), ['Hard constraints', 'Compensation', 'Summary']);   // the last: the rest of the page, drawn as cards
  assert.deepEqual(inputs().map(i => i.value), ['Switzerland', 'Geneva; ❓ relocate', 'CHF 150k']);
  assert.equal(button('Save changes').disabled, true);
  inputs()[0].value = 'Switzerland and EU';
  inputs()[0].listeners.input();
  assert.equal(button('Save changes').disabled, false);
  await button('Save changes').listeners.click();
  assert.equal(sent[0], 'profile');
  assert.match(sent[1], /\| Countries \| Switzerland and EU \|/);
  assert.match(sent[1], /# Summary\n\nSRE\./);
});

test('Notion: the form renders from the outline and sends only the changed cell or bullet', async () => {
  const outline = {sections: [{kind: 'constraints', heading: 'Hard constraints', notes: 'Filtered before scoring.', header: ['Constraint', 'Value'],
    rows: [{id: 'r1', cells: ['Countries', 'Switzerland']}, {id: 'r2', cells: ['Work mode', 'Hybrid']}], bullets: []},
  {kind: 'pay', heading: 'Compensation', notes: '', header: ['', ''], rows: [], bullets: [{id: 'b1', label: 'Target', value: 'CHF 150k'}]}], rest: 'Summary text.'};
  let sent = null;
  globalThis.window.pilot = {...globalThis.window.pilot, textGet: async () => ({ok: true, editable: false, markdown: 'flat'}), profileForm: async () => ({ok: true, ...outline}),
    profileFormSave: async changes => { sent = changes; return {ok: true, ...outline}; }};
  await loadProfileForm();
  assert.deepEqual(inputs().map(i => i.value), ['Switzerland', 'Hybrid', 'CHF 150k']);
  assert.ok(body.all(c => c.tagName === 'TEXTAREA').every(t => t.readOnly), 'notes and the rest are read-only on Notion');
  inputs()[1].value = 'Remote';
  inputs()[1].listeners.input();
  inputs()[2].value = 'CHF 160k';
  inputs()[2].listeners.input();
  await button('Save changes').listeners.click();
  assert.deepEqual(sent, [{id: 'r2', kind: 'cell', value: 'Remote'}, {id: 'b1', kind: 'bullet', value: 'CHF 160k'}]);
});

test('Notion without form data falls back to the plain read-only view', async () => {
  globalThis.window.pilot = {...globalThis.window.pilot, textGet: async () => ({ok: true, editable: false, markdown: 'The whole page, flat.'}), profileForm: async () => ({ok: false})};
  await loadProfileForm();
  assert.equal(body.all(c => c.tagName === 'H4').length, 0, 'no form sections');
  assert.match(body.textContent, /The whole page, flat\./);   // drawn as read-only cards (text-cards.js)
  assert.equal(body.all(c => c.tagName === 'BUTTON' || (c.tagName === 'INPUT' && c.type !== 'search')).length, 0, 'nothing to edit or remove');
});
