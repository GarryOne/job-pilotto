import test from 'node:test';
import assert from 'node:assert/strict';
import {answer, template} from '../lib/app-menu.js';

test('Mac: Check for Updates… right under About; standard menus kept', () => {
  const click = () => {};
  const menu = template({name: 'Job Pilotto', mac: true, checkForUpdates: click});
  assert.equal(menu[0].label, 'Job Pilotto');
  assert.equal(menu[0].submenu[0].role, 'about');
  assert.deepEqual(menu[0].submenu[1], {label: 'Check for Updates…', click});
  assert.ok(menu[0].submenu.some(item => item.role === 'quit'));
  for (const role of ['editMenu', 'viewMenu', 'windowMenu']) assert.ok(menu.some(item => item.role === role), role);
});

test('Windows: no app menu; Check for Updates… in Help', () => {
  const menu = template({name: 'Job Pilotto', mac: false, checkForUpdates: () => {}});
  assert.ok(!menu.some(item => item.label === 'Job Pilotto'));
  assert.equal(menu.at(-1).submenu[0].label, 'Check for Updates…');
});

test('the answer: up to date, an update to install, or why the check failed', () => {
  assert.equal(answer({ok: true, offer: null}, '0.4.0-alpha.65').message, 'You\'re up to date');
  const offer = answer({ok: true, offer: {version: '0.4.0-alpha.66'}}, '0.4.0-alpha.65');
  assert.equal(offer.install, true);
  assert.deepEqual(offer.buttons, ['Update now', 'Later']);
  assert.match(answer({ok: false, text: 'offline'}, 'x').detail, /offline/);
});
