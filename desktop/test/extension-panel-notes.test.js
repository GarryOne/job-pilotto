// One message surface per page (owner, 15 Oct 2026: "why do we see both panels, top-right and bottom-left?"): every note goes into the panel's note line while the panel is on the page,
// the floating box only for a page without one; and a page with no form never says Ready or counts (the panel reads the page mark the fill flow sets).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = name => fs.readFileSync(new URL(`../../extension/${name}`, import.meta.url), 'utf8');

test('a note reaches the panel first: shown means no toast, no answer means the fallback box', async () => {
  const sent = [];
  globalThis.chrome = {tabs: {sendMessage: async (tab, message) => { sent.push([tab, message]); return tab === 1 ? {shown: true} : tab === 2 ? {shown: false} : Promise.reject(new Error('no receiver')); }}};
  const {tellPanel} = await import('../../extension/page-notes.js');
  assert.equal(await tellPanel(1, 'A dialog is in the way', false), true);
  assert.equal(await tellPanel(2, 'x'), false);        // the panel is not on the page
  assert.equal(await tellPanel(3, 'x'), false);        // no panel script at all
  assert.deepEqual(sent[0], [1, {type: 'panelNote', text: 'A dialog is in the way', anyway: false}]);
});

test('class: every toast the worker draws asks the panel first, and the panel answers panelNote', () => {
  const background = read('background.js');
  const toasts = [...background.matchAll(/^async function (\w+)\(([^)]*)\) \{[^\n]*\n([\s\S]*?)^\}/gm)].filter(([, , , body]) => /top:12px;right:12px/.test(body));
  assert.deepEqual(toasts.map(([, name]) => name).sort(), ['ineligibleNote', 'note']);   // the only two note toasts of background.js (the step box is the panel's already, progress())
  for (const [, name, , body] of toasts) assert.ok(body.indexOf('tellPanel(') > -1 && body.indexOf('tellPanel(') < body.indexOf('top:12px'), `${name} draws before asking the panel`);
  assert.match(read('review.js'), /message\?\.type !== 'panelNote'[\s\S]*note\(String\(message\.text/);
  // dialog-after-fill.js and submit-watch.js reach the screen only through note() (their own box would be a second surface).
  for (const file of ['dialog-after-fill.js', 'submit-watch.js', 'fill-flow.js', 'flow.js']) assert.doesNotMatch(read(file), /top:12px;right:12px/, `${file} draws its own box`);
});

test('a page mark of posting or opening is never Ready and never counts; the fill flow sets it from the AI\'s kind', async () => {
  const panel = read('review.js');
  assert.match(panel, /ready = !moved && !pageMark && total > 0 && left === 0/);
  assert.match(panel, /pageMark \? \(pageMark === 'opening' \? 'Opening the form…' : 'Press Apply to open the form'\)/g);
  assert.match(read('fill-flow.js'), /markPage\(tab\.id, role\);/);
  assert.match(read('fill-flow.js'), /markPage\(tab\.id, role, pressed\);/);
  const attrs = new Map();
  globalThis.document = {documentElement: {setAttribute: (key, value) => attrs.set(key, value), removeAttribute: key => attrs.delete(key)}};
  globalThis.chrome = {scripting: {executeScript: async ({func, args}) => func(...args)}};
  const {markPage} = await import('../../extension/page-mark.js');
  await markPage(1, 'no-form'); assert.equal(attrs.get('data-jobpilotto-page'), 'posting');
  await markPage(1, 'no-form', true); assert.equal(attrs.get('data-jobpilotto-page'), 'opening');
  await markPage(1, 'form'); assert.equal(attrs.has('data-jobpilotto-page'), false);
});
