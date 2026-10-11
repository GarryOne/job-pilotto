// A dialog that opens while the form is filled (a site's "your fields may be replaced, continue?" after our upload) is closed without agreeing, and one
// still over the form after that is reported (extension/dialog-after-fill.js). The dialog is found by structure (popup-page.js), in any language.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadJsdom } from './helpers/page.js';
import { LEFT_OPEN, settleDialogs } from '../../extension/dialog-after-fill.js';

const JSDOM = await loadJsdom();
const MODAL = '<form><input type="text" name="a"><input type="file" name="cv"></form>'
  + '<div role="dialog"><p>IMPORTACIÓN DE DATOS: Es posible que se sustituyan los campos que ya haya rellenado. ¿Está seguro de que desea continuar?</p>'
  + '<button id="go">CONTINUAR</button><button id="no">CANCELAR</button><button id="x">X</button></div>';

async function inPage(html, run) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://jobs.example/apply', pretendToBeVisual: true });
  const keep = { window: globalThis.window, document: globalThis.document, getComputedStyle: globalThis.getComputedStyle, location: globalThis.location };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), location: dom.window.location });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 600, height: 400, top: 0, left: 0, bottom: 400, right: 600 });
  try { return await run(await import('../../extension/popup-page.js'), dom.window); } finally { Object.assign(globalThis, keep); }
}

test('a modal after the fill: the app\'s pick (not agreeing) is pressed, nothing is left', { skip: !JSDOM }, async () => {
  await inPage(MODAL, async ({ findPopup }, win) => {
    const pressed = [];
    win.document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { pressed.push(b.id); if (b.id !== 'go') win.document.querySelector('[role=dialog]').remove(); }));
    const close = async () => { const seen = findPopup({ list: true }); return seen ? findPopup({ press: 'CANCELAR' }) : ''; };   // the pick: the closing button
    const out = await settleDialogs(1, { close, look: async () => findPopup({ list: true }), settleMs: 0 });
    assert.deepEqual(pressed, ['no']);
    assert.equal(out.closed, 'CANCELAR');
    assert.equal(out.left, null);
  });
});

test('a modal no button closes is reported as left open', { skip: !JSDOM }, async () => {
  await inPage(MODAL, async ({ findPopup }) => {
    const out = await settleDialogs(1, { close: async () => '', look: async () => findPopup({ list: true }), settleMs: 0 });
    assert.equal(out.closed, '');
    assert.deepEqual(out.left.buttons, ['CONTINUAR', 'CANCELAR', 'X']);
    assert.match(LEFT_OPEN, /dialog was left open over the form/);
  });
});

test('no dialog: nothing closed, nothing left; a failing look is not a dialog', async () => {
  assert.deepEqual(await settleDialogs(1, { close: async () => '', look: async () => null, settleMs: 0 }), { closed: '', left: null });
  assert.deepEqual(await settleDialogs(1, { close: async () => { throw new Error('x'); }, look: async () => { throw new Error('y'); }, settleMs: 0 }), { closed: '', left: null });
});

test('the background asks after every fill', async () => {
  const fs = await import('node:fs');
  const text = fs.readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');
  assert.match(text, /closeFillDialogs\(tab, \{close: closePopup, look: popupLeft, decide\}\)/);
});

test('the fill\'s end logs what it closed and what is left', async () => {
  const { closeFillDialogs } = await import('../../extension/dialog-after-fill.js');
  const lines = [];
  await closeFillDialogs({ id: 1, url: 'https://jobs.example/apply' }, { close: async () => 'CANCELAR', look: async () => ({ text: 't', buttons: ['A'] }), decide: (_k, text) => lines.push(text) });
  assert.deepEqual(lines, ['closed a dialog opened by the fill', LEFT_OPEN]);
});
