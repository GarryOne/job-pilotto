// The desktop follows the page in real time (owner, 16 Oct 2026): "Reading this page" → "Apply button detected. Redirecting…" → "Sign in form detected" → "Logging in…" → the
// form's own state. The extension's worker sends each step (extension/page-mark.js), so a page with no panel (a small sign-in page) moves the card too.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import * as review from '../lib/review.js';
import {pageLine, PAGE_LINES} from '../renderer/session-state.js';

test('each step the extension sends replaces the card\'s line at once, with no counts; the form brings back the panel\'s counts', () => {
  review._reset();
  const seen = [];
  review.setReporter(state => seen.push(state.page || 'form'));
  for (const page of ['reading', 'posting', 'opening', 'reading', 'account', 'signing-in', 'reading']) {
    assert.equal(review.notePage('s1', page), true, page);
    const state = review.allStates().find(entry => entry.id === 's1');
    assert.deepEqual([state.page, state.total, state.ready], [page, 0, false], page);
  }
  assert.equal(review.notePage('s1', 'form'), true);
  assert.equal(review.allStates().find(entry => entry.id === 's1').page, undefined, 'the line goes; the form\'s panel reports its counts');
  assert.deepEqual(seen, ['reading', 'posting', 'opening', 'reading', 'account', 'signing-in', 'reading', 'form']);
  assert.equal(review.notePage('s1', 'whatever'), false, 'only the known steps');
});

test('the owner\'s words for each step, on the card and the list row', () => {
  assert.equal(pageLine('reading'), 'Reading this page…');
  assert.equal(pageLine('posting'), 'Apply button detected. Redirecting…');
  assert.equal(pageLine('opening'), 'Apply button detected. Redirecting…');
  assert.equal(pageLine('account'), 'Sign in form detected');
  assert.equal(pageLine('signing-in'), 'Logging in…');
  for (const page of review.LINE_PAGES) assert.ok(PAGE_LINES[page], `${page} has words`);
});

test('the worker says every step to the app, and the sign-in press says "Logging in"', async () => {
  const read = name => fs.readFileSync(new URL(`../../extension/${name}`, import.meta.url), 'utf8');
  assert.match(read('page-mark.js'), /type: 'page', page, session/);
  assert.match(read('fill-flow.js'), /sayStep\(tab\.id, 'Reading this page…'\); markPage\(tab\.id, 'reading'\);/);
  assert.match(read('account-step.js'), /markPage\(tab\.id, 'signing', false, \{accountStep: step\}\);/);
  const {markOf} = await import('../../extension/tab-pages.js');
  assert.deepEqual([markOf('signing', false, 'sign_in'), markOf('signing', false, 'sign_up')], ['signing-in', 'signing-up']);
  assert.match(fs.readFileSync(new URL('../lib/ext-server-handlers.js', import.meta.url), 'utf8'), /server\.setPageHandler\(/);
  assert.match(fs.readFileSync(new URL('../lib/server.js', import.meta.url), 'utf8'), /if \(event\.type === 'page'\) \{ pageHandler\(event\); return; \}/);
});
