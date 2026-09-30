// Interviews → the Insights card (renderer/interview-insight.js): hidden without a reviewed interview, "Based on 1
// interview" and tentative with one, patterns and to-dos with links to the interviews with several; and its Refresh
// (lib/interviews.js refreshInsights). On a tiny stand-in for the DOM.
import assert from 'node:assert/strict';
import {test} from 'node:test';

class FakeNode {
  constructor(tag) { Object.assign(this, {tag, children: [], listeners: {}, style: {}, dataset: {}, className: '', textContent: '', title: ''}); }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(kind, run) { this.listeners[kind] = run; }
  get classList() { return {add: name => { this.className = `${this.className} ${name}`.trim(); }}; }
  text() { return this.textContent + this.children.map(child => (typeof child === 'string' ? child : child.text?.() ?? '')).join(''); }
  all(pred, out = []) { if (pred(this)) out.push(this); for (const c of this.children) if (c instanceof FakeNode) c.all(pred, out); return out; }
}
globalThis.Node = FakeNode;
globalThis.document = {createElement: tag => new FakeNode(tag), createElementNS: (_, tag) => new FakeNode(tag),
  body: new FakeNode('body'), addEventListener() {}, querySelector: () => null};
globalThis.window ??= {addEventListener() {}};
const {insightView, insightCard, ago} = await import('../renderer/interview-insight.js');
const {refreshInsights} = await import('../lib/interviews.js');

const NOW = Date.parse('2026-09-30T12:00:00Z');
const row = (id, overall, title = `Acme · ${id}`) => ({id, title, overall, application: []});
const ONE = {headline: 'Postgres failover lacked numbers', confidence: 'low', sample: 1, updated: '2026-09-30T11:00:00Z',
  patterns: [{text: 'Failover answer lacked RTO numbers', round_type: 'Technical', interviews: ['iv-1'], tentative: true,
    evidence: [{interview: 'iv-1', quote: 'lacked RTO numbers'}]}],
  next_steps: [{text: 'Practise a failover story', interviews: ['iv-1']}], interviews: [{id: 'iv-1', title: 'Acme · Technical 1'}]};
const MANY = {...ONE, confidence: 'medium', sample: 3, patterns: [
  {text: 'Databases keep coming up weak', round_type: 'Technical', interviews: ['iv-1', 'iv-2'], tentative: false, evidence: []},
  {text: 'The screen went well', round_type: 'Recruiter screen', interviews: ['iv-3'], tentative: true, evidence: []}],
  interviews: [{id: 'iv-1', title: 'A'}, {id: 'iv-2', title: 'B'}, {id: 'iv-3', title: 'C'}]};

test('no reviewed interview: no card, even with an old insight', () => {
  assert.equal(insightView(null, []), null);
  assert.equal(insightView(ONE, [row('iv-1', '')]), null);
});

test('one interview: "Based on 1 interview", every pattern tentative, low confidence', () => {
  const view = insightView(ONE, [row('iv-1', 'neutral', 'Acme · Technical 1')], NOW);
  assert.equal(view.basis, 'Based on 1 interview · updated 1 h ago');
  assert.deepEqual(view.patterns.map(p => [p.tag, p.tentative]), [['Tentative', true]]);
  assert.equal(view.confidence[1], 'Low confidence');
  const body = insightCard(view);
  const text = body.map(node => node.text()).join(' ');
  assert.match(text, /Based on 1 interview/);
  assert.match(text, /Tentative/);
  assert.match(text, /What to do next/);
});

test('several interviews: patterns with their interview links; a click opens that interview; new reviews are flagged', () => {
  const rows = [row('iv-1', 'negative', 'A'), row('iv-2', 'neutral', 'B'), row('iv-3', 'positive', 'C'), row('iv-4', 'positive', 'D')];
  const view = insightView(MANY, rows, NOW);
  assert.equal(view.basis, 'Based on 3 interviews · updated 1 h ago · 1 new review not included yet');
  assert.deepEqual(view.patterns.map(p => p.tag), ['2 interviews', 'Tentative']);
  const opened = [];
  const body = insightCard(view, {open: id => opened.push(id)});
  const links = body.flatMap(node => node.all(n => n.className === 'link small'));
  assert.deepEqual(links.map(l => l.textContent).slice(0, 3), ['A', 'B', 'C']);
  links[1].listeners.click();
  assert.deepEqual(opened, ['iv-2']);
});

test('reviewed interviews but no insight saved yet: the card asks for a Refresh', () => {
  const view = insightView(null, [row('iv-1', 'positive')]);
  assert.equal(view.empty, true);
  const text = insightCard(view).map(node => node.text()).join(' ');
  assert.match(text, /No insights yet/);
  assert.doesNotMatch(text, /Patterns/);
});

test('Refresh: a click runs it; while busy the button is off and says so', () => {
  let asked = 0;
  const view = insightView(ONE, [row('iv-1', 'neutral')], NOW);
  const button = insightCard(view, {refresh: () => { asked += 1; }})[0].all(n => n.className.includes('iv-insight-refresh'))[0];
  button.listeners.click();
  assert.equal(asked, 1);
  const busy = insightCard(view, {busy: true})[0].all(n => n.className.includes('iv-insight-refresh'))[0];
  assert.equal(busy.disabled, true);
  assert.match(busy.text(), /Refreshing/);
});

test('a row written before its Data column: its text columns as bullets', () => {
  const view = insightView({headline: 'h', sample: 2, evidence: '• Pattern one (2 interviews; Technical)\n    A: “quote”', action: '• Do this'},
    [row('iv-1', 'good'), row('iv-2', 'good')], NOW);
  assert.deepEqual(view.patterns.map(p => p.text), ['Pattern one (2 interviews; Technical)']);
  assert.deepEqual(view.steps.map(s => s.text), ['Do this']);
});

test('ago', () => {
  assert.equal(ago('2026-09-30T11:59:50Z', NOW), 'just now');
  assert.equal(ago('2026-09-27T12:00:00Z', NOW), '3 days ago');
});

test('refreshInsights runs the Python command and returns its answer; garbage is an error', async () => {
  const calls = [];
  const ok = await refreshInsights({}, async (_, args) => { calls.push(args); return {code: 0, stdout: 'log\n{"ok": true, "status": "unchanged"}\n'}; });
  assert.deepEqual(calls[0], ['src.ai.interview_insights', 'refresh']);
  assert.deepEqual(ok, {ok: true, status: 'unchanged'});
  const bad = await refreshInsights({}, async (_, __, onLine) => { onLine('Traceback: boom'); return {code: 1, stdout: ''}; });
  assert.deepEqual(bad, {ok: false, error: 'Traceback: boom'});
});
