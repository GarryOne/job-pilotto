// The press floor (extension/page/submit-press.js): the extension never presses a control that deletes an account or data, withdraws an application or signs out, nor one that declines inside a dialog that is no cookie notice
// (15 Oct 2026, owner's Chrome: the "Decline" of a Data Privacy Consent Statement opened "Delete All Data"). One loop over the press paths and the controls; a real cookie banner is still closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage } from './helpers/page.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const JSDOM = await loadJsdom();

// [what it is, dialog markup, the button's label, is it pressed?]
const CASES = [
  ['a privacy consent statement\'s Decline', '<div role="dialog"><p>Data Privacy Consent Statement. I consent to the processing of my personal data.</p><button>Accept</button><button>Decline</button><button>Print</button></div>', 'Decline', false],
  ['a statement that speaks of cookies and tracking too', '<div role="dialog"><h2>Data Privacy Consent Statement</h2><p>We process your personal data, cookies and tracking identifiers (GDPR).</p><button>Accept</button><button>Decline</button></div>', 'Decline', false],
  ['a reject in a terms dialog', '<div role="dialog"><p>Terms of use for applicants</p><button>Reject</button></div>', 'Reject', false],
  ['the follow-up "Delete All Data"', '<div role="dialog"><p>Warning! This action will permanently delete your account.</p><button>Delete All Data</button><button>Cancel</button></div>', 'Delete All Data', false],
  ['withdraw the application', '<div role="dialog"><p>Are you sure?</p><button>Withdraw application</button></div>', 'Withdraw application', false],
  ['sign out', '<div role="dialog"><p>Session over</p><button>Sign out</button></div>', 'Sign out', false],
  ['a German decline', '<div role="dialog"><p>Einwilligung zur Datenverarbeitung</p><button>Ablehnen</button></div>', 'Ablehnen', false],
  ['the Cancel of a delete warning (a plain close)', '<div role="dialog"><p>Warning! This will permanently delete your account.</p><button>Delete All Data</button><button>Cancel</button></div>', 'Cancel', true],
  ['a cookie banner\'s Reject all', '<div role="dialog"><p>We use cookies to improve your experience.</p><button>Accept all</button><button>Reject all</button></div>', 'Reject all', true],
  ['a cookie banner\'s Decline', '<div role="dialog"><p>This site uses cookies and tracking.</p><button>Decline</button></div>', 'Decline', true],
  ['a newsletter popup\'s No thanks', '<div role="dialog"><p>Join our newsletter</p><button>No thanks</button></div>', 'No thanks', true],
  ['a form radio "I decline" outside any dialog', '<form><label><input type="radio" id="r"> I decline</label></form>', 'I decline', true],
];

test('the press floor refuses what deletes, withdraws, signs out or declines a consent, and lets a plain close through', { skip: !JSDOM }, () => {
  for (const [what, markup, label, pressed] of CASES) {
    const { window } = openPage(JSDOM, markup);
    window.eval(read('extension/page/submit-press.js'));
    const el = [...window.document.querySelectorAll('button, input, label')].find((node) => (node.innerText || node.textContent).trim() === label);
    let clicked = 0;
    el.click = () => { clicked += 1; };
    assert.equal(window.__jobPilottoPress(el), true, what);
    assert.equal(clicked, pressed ? 1 : 0, `${what}: ${pressed ? 'must be pressed' : 'must be refused'}`);
    assert.equal(!!window.__jobPilottoRefused, !pressed, `${what}: refusal recorded`);
    window.close();
  }
});

// The press paths: each closer injects its page function and presses through the marked press (the other test in submit-press.test.js fails on a bare .click()), so the floor covers all of them.
test('every page-side press path ends in the marked press, which holds the floor', () => {
  const paths = ['extension/page/visit-page.js', 'extension/popup-page.js', 'extension/on-top.js', 'extension/account-fill.js', 'extension/next-step.js', 'extension/apply-press.js', 'extension/sections.js', 'extension/page/controls.js']
    .map((file) => (fs.existsSync(new URL(`../../${file}`, import.meta.url)) ? file : file.replace('extension/page/visit-page.js', 'extension/visit-page.js')));
  for (const file of paths) assert.match(read(file), /__jobPilottoPress\?\.\(/, `${file} presses through the marked press`);
  assert.match(read('extension/page/submit-press.js'), /refused\(el\)/, 'the marked press checks the floor');
});

// The cookie closer of the application flow (visit-page.js closeConsent, cookiesOnly): a privacy statement of the form is no cookie banner, a real banner still closes.
test('the application flow\'s cookie closer leaves a privacy statement alone and still closes a cookie banner', { skip: !JSDOM }, () => {
  const run = (markup) => {
    const { window } = openPage(JSDOM, markup);
    Object.defineProperty(window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });   // jsdom has no layout text
    window.eval(`${read('extension/visit-page.js').replace(/^export /gm, '')}\nwindow.__out = closeConsent({cookiesOnly: true});`);
    const out = window.__out;
    window.close();
    return out;
  };
  const statement = '<div role="dialog"><h2>Data Privacy Consent Statement</h2><p>Your data, cookies and tracking by our recruiting system: GDPR.</p><button>Accept</button><button>Decline</button><button>Print</button></div>';
  assert.equal(run(statement), '', 'the statement\'s Decline is not pressed');
  assert.equal(run('<div role="dialog" id="cookie-banner"><p>We use cookies.</p><button>Accept all</button><button>Reject all</button></div>'), 'Reject all');
});
