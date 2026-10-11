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
  assert.match(text, /closeFillDialogs\(tab, \{close: closePopup, look: layerOnTop, decide\}\)/);
});

test('the fill\'s end logs what it closed and what is left', async () => {
  const { closeFillDialogs } = await import('../../extension/dialog-after-fill.js');
  const lines = [];
  await closeFillDialogs({ id: 1, url: 'https://jobs.example/apply' }, { close: async () => 'CANCELAR', look: async () => ({ text: 't', buttons: ['A'] }), decide: (_k, text) => lines.push(text) });
  assert.deepEqual(lines, ['closed a dialog opened by the fill', LEFT_OPEN]);
});

// The gate before the fill (owner, 11 Oct 2026: "we should not start filling any form before we close all the popups/overlays"): what covers the form is closed with the
// AI's non-agreeing button, checked again, at most 3 times; one that cannot be closed holds the fill, and nothing is typed.
test('the gate: a layer over the form is closed, checked again, and the fill goes on', async () => {
  const { clearBeforeFill } = await import('../../extension/dialog-after-fill.js');
  let open = true; const pressed = [];
  const out = await clearBeforeFill(7, { look: async () => (open ? { text: 'Subscribe', buttons: ['No thanks'] } : null), close: async () => { open = false; pressed.push('No thanks'); return 'No thanks'; }, settleMs: 0 });
  assert.deepEqual(out, { held: false, closed: ['No thanks'], layer: null });
});

test('the gate: a layer nothing closes (the AI says none: a sign-in, a robot check) holds the fill, with its text', async () => {
  const { clearBeforeFill, HELD } = await import('../../extension/dialog-after-fill.js');
  const out = await clearBeforeFill(7, { look: async () => ({ text: 'Please verify you are human', buttons: ['Verify'] }), close: async () => '', settleMs: 0 });
  assert.equal(out.held, true);
  assert.match(out.layer.text, /verify/i);
  assert.match(HELD, /dialog covers the form/);
});

test('the gate: a button that closes nothing is tried at most 3 times, then the fill is held', async () => {
  const { clearBeforeFill } = await import('../../extension/dialog-after-fill.js');
  let presses = 0;
  const out = await clearBeforeFill(7, { look: async () => ({ text: 'x', buttons: ['Close'] }), close: async () => { presses++; return 'Close'; }, settleMs: 0 });
  assert.equal(presses, 3);
  assert.equal(out.held, true);
});

test('the gate: nothing covers the form (a cookie bar away from its controls reads as none): no press, no hold; a failing look is no layer', async () => {
  const { clearBeforeFill } = await import('../../extension/dialog-after-fill.js');
  const out = await clearBeforeFill(7, { look: async () => null, close: async () => { throw new Error('must not press'); }, settleMs: 0 });
  assert.deepEqual(out, { held: false, closed: [], layer: null });
  assert.equal((await clearBeforeFill(7, { look: async () => { throw new Error('x'); }, close: async () => '', settleMs: 0 })).held, false);
});

test('the fill asks the gate first and a held fill types nothing', async () => {
  const fs = await import('node:fs');
  const flow = fs.readFileSync(new URL('../../extension/flow.js', import.meta.url), 'utf8');
  assert.match(flow, /clearBeforeFill\(tab\.id/);
  const gateAt = flow.indexOf('clearBeforeFill(tab.id');
  assert.ok(!flow.slice(flow.indexOf('export async function fillTab'), gateAt).includes('files: PAGE_FILES'), 'the gate comes before the fill injects its page scripts');
  const bg = fs.readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');
  assert.match(bg, /result\?\.held\) return holdFill/);
});

// The end check looks for what COVERS the form (on-top.js, by occlusion), not for any high layer: a live Louis Vuitton run listed a 4-button layer that covered nothing (11 Oct 2026).
test('the after-fill look is the occlusion finder: a layer that covers nothing is none', async () => {
  const { layerOnTop } = await import('../../extension/dialog-after-fill.js');
  const run = result => ({ scripting: { executeScript: async ({ func }) => { assert.equal(typeof func, 'function'); return [{ result }]; } } });
  const keep = globalThis.chrome;
  try {
    globalThis.chrome = run({ shape: 'dialog', text: 'Importación de datos', buttons: ['Cerrar la ventana'], covered: ['Apellidos'] });
    assert.deepEqual(await layerOnTop(7), { text: 'Importación de datos', buttons: ['Cerrar la ventana'] });
    globalThis.chrome = run(null);
    assert.equal(await layerOnTop(7), null);
    globalThis.chrome = { scripting: { executeScript: async () => { throw new Error('no tab'); } } };
    assert.equal(await layerOnTop(7), null);
  } finally { globalThis.chrome = keep; }
});

test('the background hands that look to the after-fill check', async () => {
  const fs = await import('node:fs');
  const bg = fs.readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');
  assert.match(bg, /closeFillDialogs\(tab, \{close: closePopup, look: layerOnTop, decide\}\)/);
});

// The worker's answer to the page's gate (extension/popup-guard.js answerGate): the same rule as the gate before the fill, asked mid-fill.
test('the gate asked mid-fill: a layer is closed and the fill goes on; one nothing closes holds it', async () => {
  globalThis.chrome ||= {};
  const { answerGate } = await import('../../extension/popup-guard.js');
  let open = true;
  assert.equal((await answerGate(3, { look: async () => (open ? { text: 'Hinweis', buttons: ['CANCELAR'] } : null), close: async () => { open = false; return 'CANCELAR'; }, say: () => {} })).held, false);
  const held = await answerGate(3, { look: async () => ({ text: 'Roboter?', buttons: ['Ja'] }), close: async () => '', say: () => {} });
  assert.equal(held.held, true);
  assert.match(held.layer.text, /Roboter/);
});

test('the fill\'s stages ask the gate, and the bridge is injected with the page scripts', async () => {
  const fs = await import('node:fs');
  const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const fill = read('extension/page/fill.js');
  assert.ok((fill.match(/await gate\(\)/g) || []).length >= 3, 'a gate between the stages');
  assert.match(fill, /summary\.held = held/);
  assert.match(read('extension/flow.js'), /files: \['guard-bridge\.js'\]/);
  assert.match(read('extension/flow.js'), /summary\?\.held\) return \{held: true/);
});
