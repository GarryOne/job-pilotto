// The tip ticker on Application sessions (owner, 2 Oct 2026): a pool of facts and advice scrolls through the page header
// while the user applies. These keep the pool honest (sourced facts, no long lines, valid system names) and the rotation
// fair (no repeats until all were shown, a system's own tips only on that system and first).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {TIPS} from '../renderer/tips-pool.js';

class FakeNode { constructor() { this.children = []; this.style = {}; } append(...n) { this.children.push(...n); } setAttribute() {} addEventListener() {} }
globalThis.Node ??= FakeNode;
globalThis.document ??= {createElement: () => new FakeNode(), createElementNS: () => new FakeNode(), body: new FakeNode(),
  addEventListener() {}, querySelector: () => null, getElementById: () => null};
globalThis.window ??= {addEventListener() {}};
const {atsOf, nextTip} = await import('../renderer/tips.js');

const SYSTEMS = ['greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters'];

test('the pool is valid: unique ids, short lines, known evidence, https sources, facts are sourced', () => {
  assert.ok(TIPS.length >= 20, 'enough tips to rotate for a while');
  assert.equal(new Set(TIPS.map(tip => tip.id)).size, TIPS.length, 'ids are unique');
  for (const tip of TIPS) {
    assert.ok(tip.text && tip.text.length <= 150, `${tip.id}: one short line`);
    assert.ok(['research', 'recruiters', 'advice', 'to-test'].includes(tip.evidence), `${tip.id}: evidence`);
    if (tip.source) assert.match(tip.source, /^https:\/\//, `${tip.id}: source is https`);
    if (tip.evidence === 'research') assert.ok(tip.source, `${tip.id}: a fact names its source`);
    if (tip.ats) assert.ok(SYSTEMS.includes(tip.ats), `${tip.id}: known system`);
    assert.doesNotMatch(tip.text, /\d+\s?%/, `${tip.id}: no invented percentages`);
  }
});

test('atsOf names the system from the address', () => {
  assert.equal(atsOf('https://job-boards.greenhouse.io/acme/jobs/1'), 'greenhouse');
  assert.equal(atsOf('https://jobs.lever.co/acme/1/apply'), 'lever');
  assert.equal(atsOf('https://jobs.ashbyhq.com/acme/1/application'), 'ashby');
  assert.equal(atsOf('https://acme.wd3.myworkdayjobs.com/en-US/x'), 'workday');
  assert.equal(atsOf('https://careers.example.com/apply'), '');
  assert.equal(atsOf('not a url'), '');
});

test('nextTip shows every tip once before any repeats', () => {
  let seen = [];
  const shown = [];
  for (let i = 0; i < TIPS.filter(tip => !tip.ats).length; i++) {
    const picked = nextTip({seen, technical: true});   // the whole pool, IT tips included
    shown.push(picked.tip.id);
    seen = picked.seen;
  }
  assert.equal(new Set(shown).size, shown.length, 'no repeat in the first round');
  assert.ok(shown.every(id => !TIPS.find(tip => tip.id === id).ats), 'system tips stay out when no system is known');
});

test('a system\'s own tips come first and only on that system', () => {
  const first = nextTip({ats: 'workday', random: () => 0});
  assert.equal(first.tip.ats, 'workday');
  for (let i = 0; i < 40; i++) {
    const picked = nextTip({ats: 'greenhouse', random: Math.random});
    assert.ok(!picked.tip.ats || picked.tip.ats === 'greenhouse');
  }
});

test('after a full round it starts over without repeating the last tip straight away', () => {
  const everything = TIPS.map(tip => tip.id);
  const picked = nextTip({seen: everything, random: () => 0});
  assert.notEqual(picked.tip.id, everything[everything.length - 1]);
  assert.deepEqual(picked.seen, [picked.tip.id]);
});

test('an empty pool gives no tip', () => {
  assert.equal(nextTip({pool: []}).tip, null);
});

test('a page\'s own topics come first, and any tip when it has none', () => {
  for (let i = 0; i < 30; i++) assert.equal(nextTip({categories: ['interview'], random: Math.random}).tip.category, 'interview');
  assert.ok(nextTip({categories: ['nothing-like-this']}).tip, 'an unknown topic still gives a tip');
  assert.ok(TIPS.some(tip => tip.category === 'interview') && TIPS.some(tip => tip.category === 'follow-up'), 'each stop has tips');
});

// The honesty rule, kept when someone adds a tip later: nothing promises an outcome, nothing says a system rejects without saying when, no invented figures.
const BANNED = [[/guarantee/i, 'a promise'], [/\bwill (be )?reject/i, 'a certain rejection'], [/\balways (reject|fail|ban)/i, 'an always'], [/\bevery (recruiter|employer|company|system)\b/i, 'an every'],
  [/\bnever (fails|works)\b/i, 'a never'], [/\b(double|triple|10x)\b/i, 'a multiplier'], [/\d+\s?(%|percent)/i, 'a percentage'], [/\bfake it\b|\bpad\b|\blie\b|\btrick\b/i, 'a trick']];
test('no tip promises an outcome or states a figure it cannot source', () => {
  for (const tip of TIPS) for (const [pattern, what] of BANNED) assert.doesNotMatch(tip.text, pattern, `${tip.id}: ${what}`);
});
test('a tip that says something rejects you says it conditionally', () => {
  for (const tip of TIPS.filter(item => /\breject(s|ed)?\b|auto-reject/i.test(item.text))) assert.match(tip.text, /\b(if|can|may|some|no major|not|never|or only)\b/i, `${tip.id}: reject needs a condition`);
});

// ---- who sees which tip (5 Oct 2026: a nurse or a photographer must not be told to write "Kubernetes, not k8s") ----
// The words only an IT candidate would recognise: the same vocabulary the UI Finder looks for on a non-IT screen (desktop/e2e/lib/uicheck.mjs).
const IT_ONLY = /\b(kubernetes|k8s|terraform|devops|sre|site reliability|ci\/cd|on-?call|deploy(?:ment)?s?|microservices?|docker|aws|gcp|azure|github|stack overflow|leetcode|system design|pull requests?|codebase|refactor)\b/i;

test('every tip with an IT example is marked for IT, and the others read the same for any profession', () => {
  for (const tip of TIPS) {
    if (tip.for) assert.equal(tip.for, 'it', `${tip.id}: the only audience is it`);
    else assert.doesNotMatch(tip.text, IT_ONLY, `${tip.id} has an IT example but is shown to everyone: mark it for: 'it' and give everyone a general tip`);
  }
  assert.ok(TIPS.some(tip => tip.for === 'it') && TIPS.filter(tip => !tip.for).length > TIPS.length / 2, 'most of the pool is general');
});

test('a tip for IT is shown to a technical candidate only; with no audience known the general ones are', async () => {
  const {nextTip} = await import('../renderer/tips.js');
  const all = (technical) => { const shown = []; let seen = []; for (let i = 0; i < TIPS.length; i++) { const next = nextTip({seen, technical, random: () => 0}); if (!next.tip) break; shown.push(next.tip); seen = next.seen; } return shown.filter((tip, i) => shown.findIndex(other => other.id === tip.id) === i); };
  assert.ok(all(false).every(tip => tip.for !== 'it'), 'a non-technical candidate is never shown an IT tip');
  assert.equal(all(false).length, TIPS.filter(tip => tip.for !== 'it' && !tip.ats).length, 'and still sees every general tip (system tips need their system)');
  assert.ok(all(true).some(tip => tip.for === 'it'), 'a technical candidate sees them');
  assert.ok(all(undefined).every(tip => tip.for !== 'it'), 'the default is the general pool');
});

test('the extension never shows a tip marked for IT: it cannot know the candidate', async () => {
  const {readFileSync} = await import('node:fs');
  const source = readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');
  assert.match(source, /TIPS\.filter\(tip => !tip\.for && /);
});
