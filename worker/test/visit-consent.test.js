// The visit reader in any language (extension/visit-page.js): a cookie banner's own buttons listed for the app to pick by meaning and the one it
// picked pressed by its exact label; the controls Claude may name as the next page include ones no English word knows (8 Oct 2026).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadJsdom } from './helpers/page.js';

const JSDOM = await loadJsdom();

async function inPage(html, run) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://emprego.example/ofertas', pretendToBeVisual: true });
  const keep = { window: globalThis.window, document: globalThis.document, getComputedStyle: globalThis.getComputedStyle, location: globalThis.location };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), location: dom.window.location });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });   // jsdom has no layout text
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 120, height: 30, top: 0, left: 0, bottom: 30, right: 120 });
  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 120, height: 30 }];
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', { get() { return dom.window.document.body; } });
  try { return await run(await import('../../extension/visit-page.js'), dom.window); } finally { Object.assign(globalThis, keep); }
}

test('a Portuguese cookie banner: its buttons are listed, and the one picked by meaning is pressed by its exact label', { skip: !JSDOM }, async () => {
  const banner = '<div role="dialog" id="cookie-banner"><p>Utilizamos cookies para melhorar a sua experiência.</p>'
    + '<button id="all">Aceitar todos</button><button id="none">Rejeitar não essenciais</button><a href="/privacidade">Saber mais</a></div>';
  await inPage(banner, ({ closeConsent }, win) => {
    let pressed = '';
    win.document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { pressed = b.id; }));
    assert.equal(closeConsent(), '', 'no word of the built-in lists knows these buttons');
    assert.deepEqual(closeConsent({ list: true }), ['Aceitar todos', 'Rejeitar não essenciais', 'Saber mais']);
    assert.equal(closeConsent({ press: 'Rejeitar não essenciais' }), 'Rejeitar não essenciais');
    assert.equal(pressed, 'none');
    assert.equal(closeConsent({ press: 'Not on this banner' }), '');
  });
});

test('the next page Claude may name: a Portuguese "Seguinte" is offered, an Apply button never', { skip: !JSDOM }, async () => {
  const list = '<ul><li class="job"><a href="/o/1">Programador</a></li><li class="job"><a href="/o/2">Analista</a></li><li class="job"><a href="/o/3">Gestor</a></li></ul>'
    + '<nav><a href="/ofertas?p=1">1</a><a href="/ofertas?p=2">Seguinte</a><button>Candidatar agora</button><button>Apply now</button></nav>';
  await inPage(list, ({ pageOutline }) => {
    const labels = pageOutline().pager.map((item) => item.label);
    assert.ok(labels.includes('1') && labels.includes('Seguinte'), labels.join(' | '));
    assert.ok(!labels.includes('Apply now'));
  });
});
