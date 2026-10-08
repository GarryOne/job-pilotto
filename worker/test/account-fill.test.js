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

import {passwordWork} from '../../extension/account-fill.js';

test('the cheap look before anything is asked of the app: how many password boxes, how many empty, whether a press of ours is still waiting', () => {
  const look = html => { const dom = new JSDOM(`<body>${html}</body>`); dom.window.HTMLElement.prototype.getClientRects = function () { return [{}]; }; Object.assign(globalThis, {document: dom.window.document}); return passwordWork(); };
  assert.deepEqual(look('<input type="password"><input type="password" value="x">'), {boxes: 2, empty: 1, pending: false});
  assert.deepEqual(look('<input type="password" value="x" data-jobpilotto-filled="1">'), {boxes: 1, empty: 0, pending: true});   // ours, its button not pressed yet
  assert.deepEqual(look('<p>An account already exists</p>'), {boxes: 0, empty: 0, pending: false});   // a notice page has none: still looked at
});

import {pressRegister} from '../../extension/account-fill.js';

function pressNamed(html, named) {
  const {window} = new JSDOM(`<body>${html}</body>`);
  window.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  Object.assign(globalThis, {document: window.document});
  const clicked = [];
  window.document.querySelectorAll('a, button').forEach(el => el.addEventListener('click', event => { event.preventDefault(); clicked.push(el.id); }));
  return {result: pressRegister(named), clicked};
}

test('a control named a little long or short is pressed when it is the only near match; several near ones are not guessed', () => {
  assert.deepEqual(pressNamed('<a id="a">Mein Profil</a><a id="b">Hilfe</a>', 'Anmelden / Mein Profil'), {result: 'pressed', clicked: ['a']});
  assert.deepEqual(pressNamed('<a id="a">Anmelden</a><a id="b">Anmelden mit Google</a>', 'Anmelden'), {result: 'pressed', clicked: ['a']});   // the exact one wins
  assert.deepEqual(pressNamed('<a id="a">Mein Profil</a><a id="b">Mein Profil neu</a>', 'Profil'), {result: 'several', clicked: []});
  assert.deepEqual(pressNamed('<a id="a">Hilfe</a>', 'Anmelden'), {result: 'not-found', clicked: []});
});
