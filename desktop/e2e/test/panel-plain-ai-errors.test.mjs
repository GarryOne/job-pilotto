/* global document */
// A malformed AI reply on a fixture form with the REAL extension: the fill keeps what it has and the panel says in plain words what happened, never a JS error text
// (owner's coordinator, 19 Oct 2026: "Cannot read properties of undefined (reading 'filter')" reached the panel). Fake applicant, stand-in app, no AI, no Submit.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startRealExtension} from '../lib/real-extension.mjs';

const FORM = `<!doctype html><title>Senior Site Reliability Engineer</title><form><h1>Apply</h1>
<label>Full name <input name="n" required></label><label>Email <input name="e" type="email" required></label>
<label>Why do you want this role? <textarea name="why" required></textarea></label></form>`;
const extensionDir = process.env.REAL_EXTENSION_DIR || undefined;
const RAW = /TypeError|Cannot read|undefined|is not a function|JSON|\[object/i;

// What a cut-off, empty or wrongly shaped reply looks like once the app has answered.
const REPLIES = {'an empty object': () => ({}), 'answers: null': () => ({answers: null, eligible: true}), 'a bare string': () => 'cut off {"answers": [{"fi'};

for (const [name, reply] of Object.entries(REPLIES)) {
  test(`${name} as Claude's reply: the panel says it was unreadable and what to do, no code error`, async () => {
    const app = await startRealExtension({extensionDir, allowAllSites: true, answer: {'/extension/answer': reply}});
    try {
      await app.context.route('https://jobs.example.test/**', route => route.fulfill({status: 200, contentType: 'text/html', body: FORM}));
      await app.page.goto('https://jobs.example.test/apply');
      assert.ok(await app.fillWithPanel(), 'the panel offers a Fill button');
      await app.page.waitForFunction(() => /couldn't answer|Answer them yourself/.test(document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.note')?.textContent || ''), null, {timeout: 60000});
      const {note} = await app.panel();
      assert.match(note, /The AI couldn't answer the questions this form asks \(its answer couldn't be read\)\. Answer them yourself, or press Fill again/, note);
      assert.doesNotMatch(note, RAW, `a raw code error reached the panel: ${note}`);
      await app.assertIsolated();
    } finally { await app.close(); }
  });
}
