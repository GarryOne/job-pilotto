// An upload field the page redraws after the file goes in (its buttons and input dropped, the file chip not drawn yet) is the upload step's question, never one
// "the reader missed": the fill record listed the CV's own title as a required "question on the page not read", left, beside the CV row filled (pool row
// "Databricks (found 2026-10-10)", 14 Oct 2026: 5 left where the page had 3; offline replay of its network record). The upload operator asked about the slot by its
// title (page/upload.js), so the title is read, like the questions the other operators answered (page/fill.js, the coverage read list).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const WIDGET = (id, title, star) => `<div class="field-wrapper"><div role="group" aria-labelledby="upload-label-${id}" aria-required="${star}" class="file-upload">`
  + `<div id="upload-label-${id}" class="label upload-label">${title}${star ? '<span class="required">*</span>' : ''}</div><div class="file-upload__wrapper"><div class="button-container">`
  + `<div class="secondary-button"><div><button type="button" class="btn">Attach</button><label class="visually-hidden" for="${id}">Attach</label><input id="${id}" class="visually-hidden" type="file" accept=".pdf"></div></div>`
  + '<div class="secondary-button"><button type="button" class="btn">Dropbox</button></div></div></div></div></div>';
const FORM = `<form><div class="field-wrapper"><label for="first">First Name<span class="required">*</span></label><input id="first" aria-required="true"></div>${WIDGET('resume', 'Resume/CV', true)}${WIDGET('cover_letter', 'Cover Letter', false)}</form>`;

test('a CV field the page empties while it takes the file is the CV row, filled; never a required question left unread', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, FORM);
  const input = window.document.getElementById('resume');
  // jsdom has no DataTransfer and its input takes only a real FileList: the smallest stand-ins, so the attach runs as in a browser.
  window.DataTransfer = class { constructor() { this.files = []; this.items = {add: file => this.files.push(file)}; } };
  let files = [];
  for (const el of window.document.querySelectorAll('input[type=file]')) Object.defineProperty(el, 'files', {get: () => (el === input ? files : []), set: list => { if (el === input) files = list; }});
  input.addEventListener('change', () => input.closest('.button-container').remove());   // the page drops its buttons and input; its file chip comes later
  const summary = await window.__jobPilottoExtensionFill([], {}, {name: 'cv.pdf', type: 'application/pdf', data: 'JVBERi0xLjQK'}, '', false);
  const trace = Array.from(summary.trace).map(row => ({...row}));
  window.close();
  assert.deepEqual(trace.filter(row => /resume|^cv$/i.test(row.label)).map(row => [row.label, row.outcome, row.reason]), [['CV', 'filled', '']],
    `the CV has one row, filled: ${JSON.stringify(trace.map(row => [row.label, row.outcome, row.reason]))}`);
  assert.deepEqual(trace.filter(row => row.type === 'file' && row.label !== 'CV').map(row => [row.label, row.required, row.outcome]), [['Cover Letter', false, 'left']]);
});
