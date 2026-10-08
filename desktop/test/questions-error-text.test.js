// "Answer once": a Notion-not-connected answer is not shown as a raw error (UI loop #170).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {questionsProblem} from '../renderer/questions-view.js';

test('Notion not connected: the card hides, no raw message', () => {
  const p = questionsProblem('Connect Notion first: your questions live in the standard answers page.');
  assert.equal(p.hide, true);
});

test('another failure: one plain sentence, retry stays', () => {
  const p = questionsProblem('fetch failed');
  assert.equal(p.hide, false);
  assert.equal(p.text, "Couldn't read your questions from Notion just now. Try again in a moment.");
});

test('the page uses the helper', () => {
  const page = fs.readFileSync(new URL('../renderer/pages/jobs-questions.js', import.meta.url), 'utf8');
  assert.match(page, /questionsProblem\(error\)/);
  assert.doesNotMatch(page, /from Notion: \$\{error\}/);
});
