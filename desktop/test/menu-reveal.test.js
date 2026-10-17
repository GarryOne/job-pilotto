// The slimmer menu: Interviews after the first application, Reports after the first weekly report, a dot once, and every screen still in ⌘K.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {PROGRESSIVE, load, looks, navOf, nextState, save} from '../renderer/menu-reveal.js';

const read = name => fs.readFileSync(new URL(`../renderer/${name}`, import.meta.url), 'utf8');
const empty = {revealed: [], opened: []};
const none = {applied: false, weeklyReport: false};

test('day 1 shows neither page; the first application shows Interviews, the first weekly report shows Reports', () => {
  assert.deepEqual(looks(nextState(empty, none), 'interviews'), {shown: false, dot: false});
  assert.deepEqual(looks(nextState(empty, none), 'reports'), {shown: false, dot: false});
  const applied = nextState(empty, {...none, applied: true});
  assert.deepEqual(looks(applied, 'interviews'), {shown: true, dot: true});
  assert.equal(looks(applied, 'reports').shown, false);
  assert.deepEqual(looks(nextState(empty, {...none, weeklyReport: true}), 'reports'), {shown: true, dot: true});
});

test('once shown a page stays, and its dot goes when it is opened (Calendar counts as Interviews)', () => {
  let state = nextState(empty, {...none, applied: true});
  state = nextState(state, none);   // the signal went away (a deleted row): the page stays
  assert.equal(looks(state, 'interviews').shown, true);
  state = nextState(state, none, 'calendar');
  assert.deepEqual(looks(state, 'interviews'), {shown: true, dot: false});
  assert.equal(navOf('calendar'), 'interviews');
});

test('a page opened from ⌘K before its signal is in the menu from then on, without a dot', () => {
  const state = nextState(empty, none, 'reports');
  assert.deepEqual(looks(state, 'reports'), {shown: true, dot: false});
});

test('the state is kept in the browser storage, and a broken one starts again', () => {
  const store = new Map(), storage = {getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value)};
  save(storage, {revealed: ['reports'], opened: []});
  assert.deepEqual(load(storage), {revealed: ['reports'], opened: []});
  store.set('jp.menu.reveal', '{not json');
  assert.deepEqual(load(storage), empty);
  assert.deepEqual(load({getItem: () => { throw new Error('blocked'); }}), empty);
});

// The class: every screen is reachable from ⌘K whether or not its menu button is shown.
test('every screen has a menu button the palette lists (hidden or not), or is a tab of one', () => {
  const html = read('index.html');
  const views = [...html.matchAll(/<div class="view[^"]*" data-view="([a-z-]+)"/g)].map(match => match[1]);
  const navs = new Set([...html.matchAll(/<button class="nav[^"]*" data-view="([a-z-]+)"/g)].map(match => match[1]));
  assert.ok(views.length >= 10, 'the views are found');
  for (const view of views) assert.ok(navs.has(navOf(view)), `${view} has a menu button (itself, or the one it is a tab of)`);
  for (const name of Object.keys(PROGRESSIVE)) assert.match(html, new RegExp(`<button class="nav" data-view="${name}" id="nav-${name}" hidden>`), `${name} starts hidden`);
  const nav = read('pages/nav.js');
  const line = nav.split('\n').find(text => text.includes("add('Go to', `Open ${labelOf(nav)}`"));
  assert.ok(line && /document\.querySelectorAll\('\.nav'\)/.test(line), 'the palette lists every .nav');
  assert.ok(!/\[hidden\]|:not\(/.test(line), 'and does not skip hidden ones');
});

test('Calendar is a tab inside Interviews: both screens carry the tab strip, and the menu has no Calendar button', () => {
  const html = read('index.html');
  assert.equal((html.match(/data-iv-tabs/g) || []).length, 2);
  assert.doesNotMatch(html, /<button class="nav[^"]*" data-view="calendar"/);
  assert.match(html, /<i data-icon="check"><\/i>Tasks/);
});
