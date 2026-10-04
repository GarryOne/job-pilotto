// Focus → the funnel cards (renderer/funnel-view.js): the Inbound funnel's steps, drawn and clickable, on a tiny
// stand-in for the DOM (the page code only needs these calls).
import assert from 'node:assert/strict';
import {test} from 'node:test';

class FakeNode {
  constructor(tag) { Object.assign(this, {tag, children: [], listeners: {}, style: {}, className: '', textContent: '', title: ''}); }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(kind, run) { this.listeners[kind] = run; }
  get classList() { return {add: name => { this.className = `${this.className} ${name}`.trim(); }}; }
  text() { return this.textContent + this.children.map(child => child.text?.() ?? '').join(''); }
}
globalThis.Node = FakeNode;
globalThis.document = {createElement: tag => new FakeNode(tag), createElementNS: (_, tag) => new FakeNode(tag),
  body: new FakeNode('body'), addEventListener() {}, querySelector: () => null};
globalThis.window ??= {addEventListener() {}};
const {EMPTY_FUNNEL_HINT, funnelIsEmpty, funnelSteps, inboundSteps} = await import('../renderer/funnel-view.js');

const INBOUND = {contacted: 4, screening: 2, interviews: 1, offers: 0, steps: [
  {step: '📥 Contacted you', reached: 4, of_contacted: 1, urls: ['l', 'm', 'n', 'o']},
  {step: '📞 Screening', reached: 2, of_contacted: 0.5, urls: ['m', 'n']},
  {step: '🧑‍💻 Interviews', reached: 1, of_contacted: 0.25, urls: ['n']},
  {step: '🏆 Offers', reached: 0, of_contacted: 0, urls: []}]};

test('the Inbound funnel: four steps, share of those who contacted you; none (no card) when nothing found you', () => {
  const steps = inboundSteps(INBOUND);
  assert.deepEqual(steps.map(s => [s.name, s.reached, s.share, s.label]), [
    ['Contacted you', 4, 100, 'Inbound: contacted you'], ['Screening', 2, 50, 'Inbound: ever reached Screening'],
    ['Interviews', 1, 25, 'Inbound: ever reached Interviews'], ['Offers', 0, 0, 'Inbound: ever reached Offers']]);
  assert.deepEqual(inboundSteps({contacted: 0, steps: INBOUND.steps.map(s => ({...s, reached: 0, urls: []}))}), []);
  assert.deepEqual(inboundSteps({contacted: 3, screening: 1, interviews: 0}), []);  // an older Focus result: no steps
  assert.deepEqual(inboundSteps(undefined), []);
});

test('each step drawn with its count, bar and share; a click (or Enter) lists exactly its opportunities', () => {
  const opened = [];
  const nodes = funnelSteps(inboundSteps(INBOUND), (label, urls) => opened.push([label, urls]));
  const steps = nodes.filter(node => node.className.startsWith('funnel-step'));
  assert.equal(nodes.length, 7);  // 4 steps, 3 arrows between them
  assert.deepEqual(steps.map(node => node.text()), ['Contacted you4100% reached', 'Screening250% reached', 'Interviews125% reached', 'Offers00% reached']);
  assert.equal(steps[1].children[0].children[2].children[0].style.width, '50%');
  steps[1].children[0].listeners.click();
  steps[2].children[0].listeners.keydown({key: 'Enter', preventDefault() {}});
  assert.deepEqual(opened, [['Inbound: ever reached Screening', ['m', 'n']], ['Inbound: ever reached Interviews', ['n']]]);
  // Nothing reached Offers: not a link.
  assert.equal(steps[3].className, 'funnel-step');
  assert.equal(steps[3].children[0].listeners.click, undefined);
  assert.match(steps[0].className, /is-link/);
});

// An <ol> may only hold <li> items (axe "list"): a clickable step keeps its <li>, the button role sits on an element inside it.
test('a clickable step is a plain list item with the button inside it', () => {
  const opened = [];
  const [first] = funnelSteps(inboundSteps(INBOUND), label => opened.push(label));
  assert.equal(first.tag, 'li');
  assert.notEqual(first.role, 'button');
  assert.equal(first.tabIndex, undefined);
  const hit = first.children[0];
  assert.equal(hit.role, 'button');
  assert.equal(hit.tabIndex, 0);
  hit.listeners.click();
  hit.listeners.keydown({key: ' ', preventDefault() {}});
  assert.equal(opened.length, 2);
});

// A new account has no applications: the engine still returns its five steps, all at 0. The card says it fills in later.
test('a funnel with nothing prepared yet is empty, one with any application is not', () => {
  const zero = ['Prepared', 'Applied', 'Human reply'].map(step => ({step, reached: 0}));
  assert.equal(funnelIsEmpty(zero), true);
  assert.equal(funnelIsEmpty([]), true);
  assert.equal(funnelIsEmpty(undefined), true);
  assert.equal(funnelIsEmpty([{step: 'Prepared', reached: 1}, {step: 'Applied', reached: 0}]), false);
  assert.match(EMPTY_FUNNEL_HINT, /fills in as you prepare and send applications/i);
});
