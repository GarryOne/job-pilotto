// The panel's own labelled "Report this form…" button (owner, 16 Oct 2026: the corner icon alone was not found): hidden until the app says the switch is on, then it opens the report card (extension/review.js, panel-markup.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage } from './helpers/page.js';
import { evalPanel } from './helpers/panel.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const JSDOM = await loadJsdom();

async function panel() {
  const { window } = openPage(JSDOM, `<form>
  <label for="a">First name *</label><input id="a" required>
  <label for="b">Last name *</label><input id="b" required>
  <label for="c">Email *</label><input id="c" type="email" required>
</form>`);
  window.chrome = { runtime: { id: 'test', sendMessage: async (message) => (message.type === 'panelAllowed' ? { ok: true } : {}), onMessage: { addListener() {} } } };
  window.eval(read('extension/page/skeleton.js'));
  window.document.documentElement.setAttribute('data-jobpilotto-page', 'form');
  evalPanel(window);
  await new Promise((resolve) => setTimeout(resolve, 60));
  return { window, button: () => window.document.getElementById('jobpilotto-review-host').shadowRoot.querySelector('.report-open') };
}

test('the panel has a labelled Report this form button, shown only once the switch is on, opening the same card', { skip: !JSDOM }, async () => {
  const { window, button } = await panel();
  try {
  assert.equal(button().textContent, 'Report this form…');
  assert.equal(button().hidden, true, 'hidden while the app has not said the switch is on');
  let opened = 0;
  window.__jobPilottoReportOpen = () => { opened += 1; };
  window.__jobPilottoReportOn = true;
  window.dispatchEvent(new window.CustomEvent('jobpilotto-report-ready'));
  assert.equal(button().hidden, false, 'shown once report-state says enabled');
  button().onclick({ isTrusted: false });   // a page script's click: ignored
  assert.equal(opened, 0);
  button().onclick({ isTrusted: true });   // the person's press (jsdom cannot make a trusted click)
  assert.equal(opened, 1, 'a trusted press opens the report card');
  } finally { window.close(); }
});
