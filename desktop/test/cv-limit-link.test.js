// The CV card offers a way out when the CV read fails on the Anthropic spending limit.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {isSpendingLimit} from '../renderer/run-warnings.js';

test('isSpendingLimit recognises the limit message', () => {
  assert.equal(isSpendingLimit('Couldn\'t read your CV: the Anthropic API spending limit was reached (back on 2026-11-01).'), true);
  assert.equal(isSpendingLimit('Your credit balance is too low'), true);
  assert.equal(isSpendingLimit('The AI service had an error; try again in a minute.'), false);
});

test('the profile page shows a billing link and holds the retry on a spending limit', () => {
  const page = readFileSync(new URL('../renderer/pages/profile.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="cv-limit-link"/);
  assert.match(page, /isSpendingLimit/);
  assert.match(page, /cv-limit-link/);
  assert.match(page, /console\.anthropic\.com/);
});
