// The visit reader in any language (extension/visit-page.js): a cookie banner's own buttons listed for the app to pick by meaning and the one it
// picked pressed by its exact label; the controls Claude may name as the next page include ones no English word knows (8 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

// The application flow (extension/consent.js, cookiesOnly): a dialog over the form that speaks of cookies is closed with its least-consent button
// (Deloitte, 9 Oct 2026: "Decline optional cookies"); a privacy or terms box of the form itself is never touched.
test('cookiesOnly: a cookie dialog over a form is declined, a privacy agreement box is left alone', { skip: !JSDOM }, async () => {
  const cookies = '<div role="dialog"><p>Deloitte uses strictly necessary cookies and similar technologies.</p>'
    + '<button id="a">Accept optional cookies</button><button id="d">Decline optional cookies</button><button id="c">Customise Cookies</button></div>';
  await inPage(cookies, ({ closeConsent }, win) => {
    let pressed = '';
    win.document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { pressed = b.id; }));
    assert.equal(closeConsent({ cookiesOnly: true }), 'Decline optional cookies');
    assert.equal(pressed, 'd');
  });
  const privacy = '<div role="dialog"><p>I have read the privacy policy and agree to the processing of my application data.</p><button id="a">I agree</button></div>';
  await inPage(privacy, ({ closeConsent }, win) => {
    let pressed = '';
    win.document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { pressed = b.id; }));
    assert.equal(closeConsent({ cookiesOnly: true }), '');
    assert.deepEqual(closeConsent({ list: true, cookiesOnly: true }), []);
    assert.equal(pressed, '');
  });
});

test('the application flow closes a cookie banner before it reads the page, only cookies', () => {
  const flow = fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8');
  assert.match(flow, /closeConsentEverywhere\(tab\.id, \{cookiesOnly: true\}\)/);
  assert.ok(flow.indexOf('closeConsentEverywhere(tab.id') < flow.indexOf('await expandSections(live)'));
});

test('the fill ends in a stuck report when nothing was filled and required fields are left; the CV reason says what happened', () => {
  const flow = fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8');
  assert.match(flow, /!\(result\?\.filled > 0\) && result\?\.unfilledRequired > 0 && open\.length/);
  assert.match(flow, /host, 'incomplete', tab\.id/);
  const fill = fs.readFileSync(new URL('../../extension/page/fill.js', import.meta.url), 'utf8');
  assert.match(fill, /resume\?\.data \? 'no place to attach it was found on this page' : 'no CV in the app'/);
});

// 9 Oct 2026: a refresh of a form tab did nothing (one fill per tab and page, for the life of the tab) and there was no button to start it.
test('a refresh looks at the page again, and the popup has a permanent Apply for a tab the app opened', () => {
  const read = name => fs.readFileSync(new URL(`../../extension/${name}`, import.meta.url), 'utf8');
  assert.match(read('tab-report.js'), /onCommitted\.addListener\(details => \{\s*if \(details\.frameId !== 0 \|\| details\.transitionType !== 'reload'\) return;[\s\S]*started\.delete\(key\)/);
  // The Apply press is tried again after a refresh (forgetApplyTries on reload), never after every press: a posting whose Apply opened the form in another tab
  // must not press it a second time (beta e2e applycv on Windows, 10 Oct 2026: the second tab was not linked to the job, no kit).
  assert.match(read('tab-report.js'), /transitionType !== 'reload'\) return;\s*forgetApplyTries\(details\.tabId\)/);
  assert.doesNotMatch(read('fill-flow.js'), /noteRole\(tab\.id, tab\.url, role\); triedApply\.delete/);
  assert.match(read('popup.html'), /id="apply-here" hidden/);
  assert.match(read('popup.js'), /\$\('apply-here'\)\.hidden = false;[\s\S]*type: 'applyHere'/);
  const messages = read('messages-panel.js');
  assert.match(messages, /message\?\.type === 'applyHere'[\s\S]*#jobpilotto-fill[\s\S]*not opened by the Job Pilotto app/);
});
