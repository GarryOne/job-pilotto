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
  for (const role of ['viewMenu', 'windowMenu']) assert.ok(menu.some(item => item.role === role), role);
  assert.ok(menu.some(item => item.label === 'Edit'));
});

test('Windows: no app menu; Check for Updates… in Help', () => {
  const menu = template({name: 'Job Pilotto', mac: false, checkForUpdates: () => {}});
  assert.ok(!menu.some(item => item.label === 'Job Pilotto'));
  assert.ok(menu.at(-1).submenu.some(item => item.label === 'Check for Updates…'));
});

test('there is no test-build opt-in: the app only offers the stable release', () => {
  const labels = template({name: 'Job Pilotto', mac: true, checkForUpdates: () => {}})[0].submenu.map(item => item.label || '');
  assert.ok(labels.includes('Check for Updates…'));
  assert.ok(!labels.some(label => /Test Build/.test(label)));
});

test('the answer: up to date, an update to install, or why the check failed', () => {
  assert.equal(answer({ok: true, offer: null}, '0.4.0-alpha.65').message, 'You\'re up to date');
  const offer = answer({ok: true, offer: {version: '0.4.0-alpha.66'}}, '0.4.0-alpha.65');
  assert.equal(offer.install, true);
  assert.deepEqual(offer.buttons, ['Update now', 'Later']);
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

test('Edit keeps copy/paste and adds Find… (⌘F), Find Next (⌘G) and Find Previous (⇧⌘G)', () => {
  const calls = [];
  const menu = template({name: 'Job Pilotto', mac: true, checkForUpdates: () => {}, find: what => calls.push(what)});
  const edit = menu.find(item => item.label === 'Edit').submenu;
  for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) assert.ok(edit.some(item => item.role === role), role);
  const find = label => edit.find(item => item.label === label);
  assert.deepEqual(['Find…', 'Find Next', 'Find Previous'].map(label => find(label).accelerator), ['CmdOrCtrl+F', 'CmdOrCtrl+G', 'Shift+CmdOrCtrl+G']);
  find('Find…').click(); find('Find Next').click(); find('Find Previous').click();
  assert.deepEqual(calls, ['open', 'next', 'previous']);
});
