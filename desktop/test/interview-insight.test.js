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
const {insightView, insightCard, ago, olderFormat} = await import('../renderer/interview-insight.js');
const {refreshInsights, insightStep, cacheWithInsight} = await import('../lib/interviews.js');

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
  assert.match(text, /Patterns across 1 interview/);
  assert.match(text, /Tentative/);
  assert.match(text, /Practice next/);
});

test('several interviews: patterns with their interview links; a click opens that interview; new reviews are flagged', () => {
  const rows = [row('iv-1', 'negative', 'A'), row('iv-2', 'neutral', 'B'), row('iv-3', 'positive', 'C'), row('iv-4', 'positive', 'D')];
  const view = insightView(MANY, rows, NOW);
  assert.equal(view.basis, 'Based on 3 interviews · updated 1 h ago · 1 new review not included yet');
  assert.deepEqual(view.patterns.map(p => p.tag), ['2 interviews', 'Tentative']);
  const opened = [];
  const body = insightCard(view, {open: id => opened.push(id)});
  const chips = body.flatMap(node => node.all(n => n.className === 'iv-chip'));
  assert.deepEqual(chips.map(l => l.textContent).slice(0, 3), ['A', 'B', 'C']);
  chips[1].listeners.click();
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

test('ticking a step runs the engine with the step and the answer; a failure is an error, not a crash', async () => {
  const calls = [];
  const ok = await insightStep({}, 'Prepare three STAR stories', true, async (_, args) => { calls.push(args); return {code: 0, stdout: '{"ok": true, "done_steps": ["prepare three star stories"]}\n'}; });
  assert.deepEqual(calls[0], ['src.ai.interview_insights', 'step', '--text', 'Prepare three STAR stories', '--done', 'yes']);
  assert.deepEqual(ok, {ok: true, done_steps: ['prepare three star stories']});
  await insightStep({}, 'x', false, async (_, args) => { calls.push(args); return {code: 0, stdout: '{"ok": true, "done_steps": []}'}; });
  assert.equal(calls[1].at(-1), 'no');
  const bad = await insightStep({}, 'x', true, async (_, __, onLine) => { onLine('Traceback: boom'); return {code: 1, stdout: ''}; });
  assert.deepEqual(bad, {ok: false, error: 'Traceback: boom'});
});

// The redesigned card (30 Sep 2026 mockup): header with subtitle and confidence chip, a primary-signal banner, patterns
// with icon, title, detail and company chips, numbered "Practice next" steps with tick boxes, a footer.
const RICH = {headline: 'Strong substance is being weakened by rambling delivery under pressure.', confidence: 'low', sample: 2, version: 6,
  headline_detail: 'The same pattern appeared in tenure and unblocking questions.', updated: '2026-09-30T10:00:00Z', url: 'https://notion.test/ins',
  patterns: [
    {text: 'Key recruiter questions take too long to reach the point.', title: 'Answers become unstructured', kind: 'weakness', round_type: 'Recruiter screen',
      interviews: ['iv-1', 'iv-2'], tentative: false, evidence: [{interview: 'iv-1', quote: 'a'}, {interview: 'iv-2', quote: 'b'}]},
    {text: 'Operational ownership is a repeatable strength.', title: 'Incident-response stories land well', kind: 'strength', round_type: 'Recruiter screen',
      interviews: ['iv-1', 'iv-2'], tentative: false, evidence: [{interview: 'iv-1', quote: 'c'}]}],
  next_steps: [
    {text: 'Prepare 2-3 tight STAR examples.', title: 'Prepare three 60-second STAR stories', focus: 'Team unblocking • Manual intervention', interviews: ['iv-1'], done: false},
    {text: 'Draft a 90-second tenure answer.', title: 'Rehearse your tenure answer', focus: '', interviews: ['iv-2'], done: true}],
  interviews: [{id: 'iv-1', title: 'Laelaps AI · Recruiter screen (via TechTree)', round_type: 'Recruiter screen'},
    {id: 'iv-2', title: 'Huxley · Recruiter screen', round_type: 'Recruiter screen'}]};
const RICH_ROWS = [row('iv-1', 'neutral', 'Laelaps AI · Recruiter screen (via TechTree)'), row('iv-2', 'neutral', 'Huxley · Recruiter screen')];

test('the header says what was read, how sure it is, and the primary signal', () => {
  const view = insightView(RICH, RICH_ROWS, NOW);
  assert.equal(view.title, 'Interview insights');
  assert.equal(view.subtitle, 'Patterns across 2 recruiter screens · Updated 2 h ago');
  assert.deepEqual([view.chip.text, view.chip.tone], ['Low confidence · 2 interviews', 'neutral']);
  assert.match(view.chip.tip, /limited/);
  assert.deepEqual(view.primary, {headline: RICH.headline, detail: RICH.headline_detail, tag: 'Seen in 2 interviews'});
});

test('a pattern is an icon kind, a title, a detail line and the companies it came from', () => {
  const view = insightView(RICH, RICH_ROWS, NOW);
  assert.deepEqual(view.patterns.map(p => [p.kind, p.title, p.detail, p.tag, p.companies.map(c => c.name)]), [
    ['weakness', 'Answers become unstructured', 'Key recruiter questions take too long to reach the point.', '2 interviews', ['Laelaps AI', 'Huxley']],
    ['strength', 'Incident-response stories land well', 'Operational ownership is a repeatable strength.', '2 interviews', ['Laelaps AI', 'Huxley']]]);
  // an insight written before titles existed: its sentence is the title, a plain note
  const old = insightView({...RICH, patterns: [{...RICH.patterns[0], title: undefined, kind: undefined}]}, RICH_ROWS, NOW);
  assert.deepEqual([old.patterns[0].title, old.patterns[0].detail, old.patterns[0].kind], [RICH.patterns[0].text, '', 'note']);
});

test('practice steps are numbered with a heading, a keyword line and their tick', () => {
  const view = insightView(RICH, RICH_ROWS, NOW);
  assert.deepEqual(view.steps.map(s => [s.n, s.title, s.detail, s.done]), [
    [1, 'Prepare three 60-second STAR stories', 'Team unblocking • Manual intervention', false],
    [2, 'Rehearse your tenure answer', 'Draft a 90-second tenure answer.', true]]);
  const old = insightView({...RICH, next_steps: [{text: 'Do this', interviews: ['iv-1']}]}, RICH_ROWS, NOW);
  assert.deepEqual([old.steps[0].title, old.steps[0].detail, old.steps[0].done], ['Do this', '', false]);
});

test('the footer counts the supporting quotes and warns while the evidence is thin', () => {
  const view = insightView(RICH, RICH_ROWS, NOW);
  assert.deepEqual(view.supporting, {count: 3, url: 'https://notion.test/ins'});
  assert.match(view.disclaimer, /limited number of interviews/);
  assert.equal(insightView({...RICH, confidence: 'high'}, RICH_ROWS, NOW).disclaimer, '');
  assert.equal(insightView({...RICH, url: ''}, RICH_ROWS, NOW).supporting, null);
});

test('ticking, opening a company\'s interview and the supporting link call back', () => {
  const ticked = [], opened = [], urls = [];
  const view = insightView(RICH, RICH_ROWS, NOW);
  const body = insightCard(view, {onTick: (step, done) => ticked.push([step.text, done]), open: id => opened.push(id), onMoments: () => urls.push('moments')});
  const boxes = body.flatMap(node => node.all(n => n.tag === 'input' && n.type === 'checkbox'));
  assert.deepEqual(boxes.map(b => b.checked), [false, true]);
  boxes[0].checked = true; boxes[0].listeners.change();
  assert.deepEqual(ticked, [['Prepare 2-3 tight STAR examples.', true]]);
  body.flatMap(node => node.all(n => n.className === 'iv-chip'))[1].listeners.click();
  assert.deepEqual(opened, ['iv-2']);
  const more = body.flatMap(node => node.all(n => n.className.includes('iv-supporting')))[0];
  more.listeners.click();
  assert.deepEqual(urls, ['moments']);
  assert.match(body.map(node => node.text()).join(' '), /View supporting moments \(3\)/);
});

test('the card folds to its header and unfolds; the toggle says which state it is in', () => {
  const view = insightView(RICH, RICH_ROWS, NOW);
  const flips = [];
  const open = insightCard(view, {onToggle: () => flips.push('toggle')});
  const toggle = open.flatMap(node => node.all(n => n.className.includes('iv-insight-toggle')))[0];
  assert.equal(toggle['aria-expanded'], 'true');
  assert.match(open.map(node => node.text()).join(' '), /Patterns observed/);
  open[0].listeners.click();  // anywhere on the bar folds it: its own click (the arrow's bubbles up to it)
  assert.deepEqual(flips, ['toggle']);
  // Refresh is on the bar too, but it only refreshes
  let refreshed = 0, stopped = 0;
  const bar = insightCard(view, {onToggle: () => flips.push('toggle'), refresh: () => { refreshed += 1; }});
  bar[0].all(n => n.className.includes('iv-insight-refresh'))[0].listeners.click({stopPropagation: () => { stopped += 1; }});
  assert.deepEqual([refreshed, stopped, flips.length], [1, 1, 1]);
  const folded = insightCard(view, {collapsed: true, onToggle: () => {}});
  const text = folded.map(node => node.text()).join(' ');
  assert.match(text, /Interview insights/);
  assert.match(text, /Low confidence · 2 interviews/);  // the header still says how sure it is
  assert.doesNotMatch(text, /Patterns observed|Practice next|PRIMARY SIGNAL|Primary signal/);
  assert.equal(folded.flatMap(node => node.all(n => n.className.includes('iv-insight-toggle')))[0]['aria-expanded'], 'false');
});

test('supporting moments: the quotes behind each pattern with the interview each came from', () => {
  const view = insightView(RICH, RICH_ROWS, NOW);
  assert.deepEqual(view.moments.map(g => [g.title, g.quotes.map(q => [q.quote, q.id, q.name])]), [
    ['Answers become unstructured', [['a', 'iv-1', 'Laelaps AI'], ['b', 'iv-2', 'Huxley']]],
    ['Incident-response stories land well', [['c', 'iv-1', 'Laelaps AI']]]]);
  assert.equal(view.supporting.count, 3);
  assert.equal(insightView({...RICH, patterns: [{...RICH.patterns[0], evidence: []}]}, RICH_ROWS, NOW).moments.length, 0);
});

test('an insight written by an older version is never refreshed by itself: the card says so and you choose (no AI spend)', () => {
  assert.equal(olderFormat({...RICH, version: 5}), true);
  assert.equal(olderFormat({...RICH, version: undefined}), true);  // saved before versions existed
  assert.equal(olderFormat({...RICH, version: 6}), false);
  assert.equal(olderFormat(null), false);
  assert.match(insightView({...RICH, version: 5}, RICH_ROWS, NOW).subtitle, /Written by an older version · Refresh to update/);
  assert.doesNotMatch(insightView({...RICH, version: 6}, RICH_ROWS, NOW).subtitle, /older version/);
});

test('each pattern says how many quotes back it, and the count opens the moments at that pattern', () => {
  const view = insightView(RICH, RICH_ROWS, NOW);
  assert.deepEqual(view.patterns.map(p => p.quotes), [2, 1]);
  const asked = [];
  const body = insightCard(view, {onMoments: title => asked.push(title)});
  const quotes = body.flatMap(node => node.all(n => n.className.includes('iv-quotes')));
  assert.deepEqual(quotes.map(q => q.textContent), ['2 quotes', '1 quote']);
  quotes[1].listeners.click({stopPropagation() {}});
  assert.deepEqual(asked, ['Incident-response stories land well']);
});

test('a Refresh while one is already running joins it: one AI call, even across window reloads (4 runs at 13:37, 30 Sep 2026)', async () => {
  let calls = 0, finish;
  const run = () => { calls += 1; return new Promise(resolve => { finish = () => resolve({code: 0, stdout: '{"ok": true, "status": "updated"}'}); }); };
  const first = refreshInsights({}, run), second = refreshInsights({}, run);
  finish();
  assert.deepEqual(await first, {ok: true, status: 'updated'});
  assert.deepEqual(await second, {ok: true, status: 'updated'});
  assert.equal(calls, 1);
  await refreshInsights({}, async () => { calls += 1; return {code: 0, stdout: '{"ok": true}'}; });  // after it ends, a new one runs
  assert.equal(calls, 2);
});

test('the confidence chip is only text: clicking it never folds the card, and a text selection on the bar does not either', () => {
  const flips = [];
  const view = insightView(RICH, RICH_ROWS, NOW);
  const head = insightCard(view, {onToggle: () => flips.push('toggle')})[0];
  const chip = head.all(n => n.className.includes('iv-confidence'))[0];
  let stopped = 0;
  chip.listeners.click({stopPropagation: () => { stopped += 1; }});
  assert.equal(stopped, 1);
  globalThis.window.getSelection = () => ({toString: () => 'Low confidence'});
  head.listeners.click({});
  assert.deepEqual(flips, []);  // selecting text is not a click to fold
  globalThis.window.getSelection = () => ({toString: () => ''});
  head.listeners.click({});
  assert.deepEqual(flips, ['toggle']);
});

test('the card says when it is out of date or still the saved copy', () => {
  const stale = insightView({...RICH, outdated: true}, RICH_ROWS, NOW);
  assert.match(stale.subtitle, /A review changed since · Refresh to update/);
  const text = insightCard(insightView(RICH, RICH_ROWS, NOW), {updating: true}).map(node => node.text()).join(' ');
  assert.match(text, /Saved copy · checking Notion…/);
  assert.doesNotMatch(insightCard(insightView(RICH, RICH_ROWS, NOW)).map(node => node.text()).join(' '), /Saved copy/);
});

test('a Refresh result goes into this Mac\'s saved copy, so the next start shows it, not an older one', () => {
  const cached = {at: '2026-09-30T09:00:00Z', result: {ok: true, interviews: [{id: 'iv-1'}], insight: {headline: 'old'}}};
  assert.deepEqual(cacheWithInsight(cached, {ok: true, insight: {headline: 'new'}}), {ok: true, interviews: [{id: 'iv-1'}], insight: {headline: 'new'}});
  assert.equal(cacheWithInsight(cached, {ok: false, error: 'x'}), null);  // a failed refresh changes nothing
  assert.equal(cacheWithInsight(null, {ok: true, insight: {}}), null);  // no saved copy yet: nothing to update
});
