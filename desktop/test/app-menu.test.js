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
  assert.ok(menu.at(-1).submenu.some(item => item.label === 'Check for Updates…'));
});

test('Get Test Builds: a checkbox once settings are loaded; the escape hatch only when it is on', () => {
  const noop = () => {};
  const items = on => template({name: 'Job Pilotto', mac: true, checkForUpdates: noop, testBuilds: on, setTestBuilds: noop, updateToNewest: noop})[0].submenu;
  assert.ok(!items(undefined).some(item => item.label === 'Get Test Builds'));
  assert.equal(items(false).find(item => item.label === 'Get Test Builds').checked, false);
  assert.ok(!items(false).some(item => /Newest Test Build/.test(item.label || '')));
  assert.ok(items(true).some(item => /Newest Test Build/.test(item.label || '')));
});

test('the answer: up to date, an update to install, or why the check failed', () => {
  assert.equal(answer({ok: true, offer: null}, '0.4.0-alpha.65').message, 'You\'re up to date');
  const offer = answer({ok: true, offer: {version: '0.4.0-alpha.66'}}, '0.4.0-alpha.65');
  assert.equal(offer.install, true);
  assert.deepEqual(offer.buttons, ['Update now', 'Later']);
  assert.match(answer({ok: true, offer: null, trial: 'Test build alpha.66 — trial 1 of 2 days'}, 'x').detail, /trial 1 of 2 days/);
  assert.match(answer({ok: false, text: 'offline'}, 'x').detail, /offline/);
});

test('Help → Send Feedback… on both platforms', () => {
  const send = () => {};
  for (const mac of [true, false]) {
    const help = template({name: 'Job Pilotto', mac, checkForUpdates: () => {}, sendFeedback: send}).at(-1);
    assert.deepEqual(help.submenu[0], {label: 'Send Feedback…', click: send});
  }
});

test('from source (npm start): no update is offered, the menu says to git pull', () => {
  const shown = answer({ok: true, offer: null, fromSource: true}, '0.4.0-alpha');
  assert.match(shown.message, /from source/);
  assert.ok(!shown.install);
});
