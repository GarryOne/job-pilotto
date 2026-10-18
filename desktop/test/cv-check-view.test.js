// The CV check card (renderer/cv-check-view.js): every state the old card drew is still drawn (not checked, parser only, parser + content), fixes first,
// the rest folded, the cost line under each action, and the header names the CV the result belongs to.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const ids = ['setting-cvcheck', 'cvc-state', 'cvc-scores', 'cvc-fixes', 'cvc-folds', 'cvc-run', 'cvc-ai-run', 'cvc-run-cost', 'cvc-ai-cost', 'cvc-message'];
for (const id of ids) { const node = globalThis.document.createElement(id.endsWith('run') ? 'button' : 'div'); node.id = id; globalThis.document.body.append(node); }
const {showCvCheck} = await import('../renderer/cv-check-view.js');
const {cvCheck} = await import('../lib/demo.js');
const $ = id => globalThis.document.getElementById(id);
const all = node => [node, ...(node.children || []).flatMap(each => all(each))];
const texts = id => all($(id)).map(node => node.textContent).join(' ');

test('each action is one row: its name, its button, its cost as a badge (no loose caption under a button); the fixes use the rows look', () => {
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  for (const [name, button, cost] of [['Readability', 'cvc-run', 'cvc-run-cost'], ['Content', 'cvc-ai-run', 'cvc-ai-cost']]) {
    assert.match(html, new RegExp(`<div class="cvc-action"><span class="cvc-action-label">${name}</span><button [^>]*id="${button}"[\\s\\S]*?</button><span class="ui-pill tone-neutral" id="${cost}">`));
  }
  assert.match(fs.readFileSync(new URL('../renderer/cv-check-view.js', import.meta.url), 'utf8'), /statusAt: 'first', rows: true/);
});

test('not checked yet: no scores, no fixes, the review waits for the readability check', () => {
  showCvCheck(null);
  assert.equal($('cvc-state').textContent, 'Not checked yet');
  assert.ok($('cvc-scores').hidden && $('cvc-fixes').hidden && $('cvc-folds').hidden);
  assert.ok($('cvc-ai-run').disabled);
  assert.equal($('cvc-run-cost').textContent, 'No AI usage');
  assert.equal($('setting-cvcheck').dataset.summary, 'Not checked yet');
});

test('parser only: readability ring, content not reviewed, parser fixes, passed checks folded', () => {
  showCvCheck({...cvCheck, ai: undefined, billing: 'subscription'}, {cvName: 'CV_Alex_Morgan.pdf', when: () => '2 Oct'});
  assert.equal($('cvc-state').textContent, 'Checked 2 Oct · CV_Alex_Morgan.pdf');
  assert.match(texts('cvc-scores'), /Readability/);
  assert.match(texts('cvc-scores'), /Not reviewed yet/);
  assert.equal(all($('cvc-scores')).filter(node => String(node.className).split(' ').includes('summary-tile')).length, 2, 'the shared summary tiles (page-parts.js)');
  assert.equal(all($('cvc-fixes')).filter(node => String(node.className).split(' ').includes('review-item')).length, 3);
  assert.match(texts('cvc-folds'), /Passed checks/);
  assert.equal($('cvc-ai-run').disabled, false);
  assert.equal($('cvc-ai-cost').textContent, 'Uses your plan allowance');
});

test('parser + content: both rings, every fix in one ranked list, score parts, strengths, missing terms and text folded', () => {
  showCvCheck({...cvCheck, billing: 'api'}, {cvName: 'CV_Alex_Morgan.pdf'});
  const rows = all($('cvc-fixes')).filter(node => String(node.className).split(' ').includes('review-item'));
  assert.equal(rows.length, 5);
  assert.match(rows[0].textContent, /High/);
  for (const words of ['Keywords for your target roles · 70', 'Working well', 'Prometheus', 'Extracted text', 'Alex Morgan']) assert.match(texts('cvc-folds'), new RegExp(words));
  assert.equal($('cvc-ai-cost').textContent, 'Last review: $0.05 · This run may differ.');
  assert.equal($('setting-cvcheck').dataset.summary, 'Mostly readable · 3 issues · 2 content suggestions');
});
