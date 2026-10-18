// Profile → Cover letter → Base letter (owner's mockup 07, 18 Oct 2026; pages/base-letter.js): a neutral "Not created" (never a green dot for nothing),
// the empty state with Draft with AI / Write my own until a choice or a letter, the editor after; who pays said before and after a draft from the
// engine settings (no estimate, no hardcoded price or duration); the forms switch only once the letter is approved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
globalThis.window.pilot = new Proxy({}, {get: () => async () => ({})});
globalThis.localStorage = {getItem: () => null, setItem: () => {}};
const {statePill, showsEditor} = await import('../renderer/pages/base-letter.js');
const {lastCost, usageAfter, usageBefore} = await import('../renderer/ai-engine-view.js');

test('the state pill: neutral when none exists, warn for a draft, good with its date once approved', () => {
  const none = statePill({state: 'none'});
  assert.equal(none.textContent, 'Not created');
  assert.match(none.className, /tone-neutral/);
  assert.doesNotMatch(none.className, /\bdot\b/);
  assert.match(statePill({state: 'draft'}).className, /tone-warn/);
  const approved = statePill({state: 'approved', approvedAt: '2026-10-18T09:00:00Z'});
  assert.match(approved.className, /tone-good/);
  assert.match(approved.textContent, /^Approved /);
});

test('the empty state shows until a choice or a letter; reading shows the editor with its skeleton', () => {
  assert.equal(showsEditor({state: 'none'}), false);
  assert.equal(showsEditor({state: 'none'}, {writing: true}), true, 'Write my own');
  assert.equal(showsEditor({state: 'none'}, {reading: true}), true, 'the skeleton stands in, so "Not created" is never just an unread letter');
  assert.equal(showsEditor({state: 'none'}, {typed: 'Dear team'}), true, 'typed text is never hidden');
  assert.equal(showsEditor({state: 'draft'}), true);
  assert.equal(showsEditor({state: 'approved'}), true);
});

test('who pays: said before from the engine, after from the run; an unknown cost is never $0', () => {
  assert.equal(usageBefore({aiFree: true}), 'Uses your AI credits.');
  assert.equal(usageBefore({aiEngine: 'cli'}), 'Uses your plan allowance.');
  assert.equal(usageBefore({aiEngine: 'api'}, true), 'Billed to your API account.');
  assert.equal(usageAfter({paidBy: 'api', usd: 0.031}), 'Cost $0.03');
  assert.equal(usageAfter({paidBy: 'api', usd: 0}), 'Billed to your API account');
  assert.equal(usageAfter({paidBy: 'credits', usd: 0.02}), 'Used your AI credits');
  assert.equal(usageAfter({}), '');
  assert.equal(lastCost({paidBy: 'api', usd: 0.03}), 'Last draft: $0.03');
  assert.equal(lastCost({paidBy: 'plan', usd: 0.03}), '');
});

test('the markup: two choices in the empty state, the usage line under each Draft with AI, no hardcoded price or duration', () => {
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const panel = html.slice(html.indexOf('id="setting-letter"'), html.indexOf('id="setting-answers'));
  const empty = panel.slice(panel.indexOf('id="letter-empty"'), panel.indexOf('id="letter-editor"'));
  assert.match(empty, /id="letter-start-ai"[\s\S]*Draft with AI/);
  assert.match(empty, /id="letter-own"[\s\S]*Write my own/);
  assert.equal((panel.match(/data-letter-usage/g) || []).length, 2);
  assert.match(panel, /preparation kit/);
  const source = fs.readFileSync(new URL('../renderer/pages/base-letter.js', import.meta.url), 'utf8');
  for (const text of [panel, source]) assert.doesNotMatch(text, /\$\d|\d+\s?s\b|seconds|\$5 credit/, 'no price or duration from the mockup');
  assert.match(source, /show\(\$\('letter-fallback-row'\), saved\.state === 'approved'\)/, 'the forms switch only for an approved letter');
});
