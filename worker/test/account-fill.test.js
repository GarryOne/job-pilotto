// The boxes the extension fills on a sign-in or sign-up page (extension/account-fill.js): the email and the password, found by what they
// are, empty and visible ones only, in any language.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {fillAccountBoxes} from '../../extension/account-fill.js';

function run(html, password) {
  const dom = new JSDOM(`<body>${html}</body>`);
  const {window} = dom;
  window.HTMLElement.prototype.getClientRects = function () { return this.hasAttribute('hidden') ? [] : [{}]; };   // jsdom has no layout
  Object.assign(globalThis, {document: window.document, HTMLInputElement: window.HTMLInputElement, Event: window.Event});
  const filled = fillAccountBoxes(password);
  const value = id => window.document.getElementById(id).value;
  return {filled, value};
}

test('a sign-up page: every empty visible password box gets the password, whatever the labels say; nothing else is touched', () => {
  const {filled, value} = run('<label>Adresse e-mail</label><input id="e" type="email"><input id="p1" type="password"><input id="p2" type="password"><input id="n" type="text">', 'Maple-42');
  assert.equal(filled, 2);
  assert.deepEqual([value('e'), value('p1'), value('p2'), value('n')], ['', 'Maple-42', 'Maple-42', '']);
});

test('boxes already filled, hidden or read-only are left alone', () => {
  const {filled, value} = run('<input id="h" type="password" hidden><input id="r" type="password" readonly><input id="k" type="password" value="mine">', 'p');
  assert.equal(filled, 0);
  assert.deepEqual([value('h'), value('r'), value('k')], ['', '', 'mine']);
});

import {pressAccountButton} from '../../extension/account-fill.js';

function press(html) {
  const {document, Node} = (() => { const dom = new JSDOM(`<body>${html}</body>`); dom.window.HTMLElement.prototype.getClientRects = function () { return [{}]; }; return dom.window; })();
  Object.assign(globalThis, {document, Node});
  let clicks = 0;
  document.querySelectorAll('button, input[type=submit]').forEach(button => button.addEventListener('click', event => { clicks++; event.preventDefault(); }));
  document.querySelector('input[type=password]')?.setAttribute('data-jobpilotto-filled', '1');
  return {reason: pressAccountButton(), clicks: () => clicks};
}

test('a sign-in form with nothing left for the person: its one button is pressed, once', () => {
  const {reason, clicks} = press('<form><input type="text" value="a@b.c"><input type="password" value="x"><button type="submit">Anmelden</button></form>');
  assert.equal(reason, 'pressed');
  assert.equal(clicks(), 1);
  assert.equal(pressAccountButton(), 'already-pressed');
});

test('not pressed: a required box or consent still empty, a frame in the form (a bot check, whoever makes it), two buttons, or nothing filled by us', () => {
  const form = inner => `<form><input type="password" value="x">${inner}</form>`;
  assert.equal(press(form('<input type="checkbox" required><button>Go</button>')).reason, 'needs-you');
  assert.equal(press(form('<iframe src="https://anything.example/widget"></iframe><button>Go</button>')).reason, 'bot-check');
  assert.equal(press(form('<button>Go</button><button>Other</button>')).reason, 'several-buttons');
  assert.equal(press(form('')).reason, 'no-button');
  const none = new JSDOM('<form><input type="password"><button>Go</button></form>').window;
  Object.assign(globalThis, {document: none.document});
  assert.equal(pressAccountButton(), 'not-filled');
});
