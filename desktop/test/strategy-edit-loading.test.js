// "Open … in Notion" buttons show work while Notion opens (about a second): openInNotion disables the button that asked and says
// "Opening…" until the app's call ends, for every caller (#66 Strategy, #74 Settings). It runs the real module on a minimal fake DOM.
import assert from 'node:assert/strict';
import {test} from 'node:test';

class FakeNode {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.style = {}; this.attrs = {}; this.textContent = ''; this.classList = {add() {}, remove() {}, toggle() {}, contains: () => false}; }
  append(...nodes) { this.children.push(...nodes.filter(node => typeof node === 'object')); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  removeAttribute(name) { delete this.attrs[name]; }
  addEventListener() {}
  querySelector(selector) { return selector === 'span' ? this.children.find(child => child.tagName === 'SPAN') || null : null; }
  querySelectorAll() { return []; }
}
globalThis.Node = FakeNode;
globalThis.document = {createElement: tag => new FakeNode(tag), createElementNS: (_, tag) => new FakeNode(tag), createTextNode: text => ({text}),
  body: new FakeNode('body'), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null};
let finish;
globalThis.window = {addEventListener() {}, pilot: {state: async () => ({notion: {NOTION_PROFILE_PAGE_ID: 'p'}}), openNotion: () => new Promise(resolve => { finish = resolve; })}};

const {openInNotion} = await import('../renderer/pages/notion-connect.js');
const {shared} = await import('../renderer/pages/shared.js');

test('the button that asked is disabled and says "Opening…" until Notion has opened, then is as before', async () => {
  shared.state = {...(shared.state || {}), notion: {NOTION_PROFILE_PAGE_ID: 'https://notion.so/p'}, notionConnected: true, settings: {notionIds: {NOTION_PROFILE_PAGE_ID: 'p'}}};
  const button = new FakeNode('button'), label = new FakeNode('span');
  label.textContent = 'Edit in Notion';
  button.append(new FakeNode('i'), label);
  const opening = openInNotion('NOTION_PROFILE_PAGE_ID', {currentTarget: button});
  assert.equal(button.disabled, true);
  assert.equal(label.textContent, 'Opening…');
  assert.equal(button.children[0].tagName, 'I');   // the icon is kept
  finish(true);
  await opening;
  assert.equal(button.disabled, false);
  assert.equal(label.textContent, 'Edit in Notion');
  assert.equal(button.getAttribute('aria-busy'), null);
});
