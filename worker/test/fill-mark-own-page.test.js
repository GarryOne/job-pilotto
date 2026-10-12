// A fill's state mark (<html data-jobpilotto-fill>, read by the session's Claude, the form judge's wait and the e2e steps) goes only into the page that fill started on
// (13 Oct 2026, applycv "a sign-up page before the form": the sign-up page's fill ended after the tab had moved to the form; its "done" landed on the form, and the
// step read the form before that page's own fill). Every writer: extension/fill-flow.js writeState and background.js handOff's state().
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

// A tab whose document can be replaced (a navigation): executeScript runs the page function against the current document, with that document's own script world.
function fakeTab() {
  const tab = {doc: null, navigate() { tab.doc = {world: {}, documentElement: {dataset: {}}}; }};
  tab.navigate();
  globalThis.chrome = {scripting: {executeScript: async ({func, args}) => {
    const keep = {window: globalThis.window, document: globalThis.document};
    globalThis.window = tab.doc.world; globalThis.document = tab.doc;
    try { return [{result: func(...(args || []))}]; } finally { Object.assign(globalThis, keep); }
  }}};
  return tab;
}

test('fill-flow.js: the end state is written only into the page the fill started on', async () => {
  const keep = globalThis.chrome;
  try {
    const {writeState} = await import('../../extension/fill-flow.js');
    const tab = fakeTab();
    await writeState(1, {state: 'running'}, 'fill-a');
    await writeState(1, {state: 'done', filled: 2}, 'fill-a');
    assert.equal(JSON.parse(tab.doc.documentElement.dataset.jobpilottoFill).state, 'done', 'same page: done is written');
    await writeState(1, {state: 'running'}, 'fill-b');
    tab.navigate();   // the person (or the page) moved the tab on before the fill ended
    await writeState(1, {state: 'done', filled: 2}, 'fill-b');
    assert.equal(tab.doc.documentElement.dataset.jobpilottoFill, undefined, 'the next page gets no "done" from the fill before it');
    await writeState(1, {state: 'no-form'});
    assert.equal(JSON.parse(tab.doc.documentElement.dataset.jobpilottoFill).state, 'no-form', 'a single state with no fill behind it is written as before');
  } finally { globalThis.chrome = keep; }
});

test('background.js handOff writes its states through the same rule (the class: every writer of the mark)', () => {
  const source = fs.readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');
  const writers = [...source.matchAll(/dataset\.jobpilottoFill = text/g)].length;
  assert.equal(writers, 1, 'one writer of the state mark in background.js');
  assert.match(source, /if \(now === 'running'\) window\.__jobPilottoFillToken = token; else if \(now !== 'error' && window\.__jobPilottoFillToken !== token\) return;/);
});
