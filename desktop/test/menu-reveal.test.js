// The slimmer menu: Interviews after the first application, Reports after the first weekly report, a dot once, and every screen still in ⌘K.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {PROGRESSIVE, load, looks, navOf, nextState, save, stillLocked} from '../renderer/menu-reveal.js';
import {STOPS, markSeen, seen, stopsFor} from '../renderer/menu-tour.js';

const read = name => fs.readFileSync(new URL(`../renderer/${name}`, import.meta.url), 'utf8');
const empty = {revealed: [], opened: []};
const none = {applied: false, weeklyReport: false, employers: false};

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
  assert.match(html, /<i data-icon="check"><\/i>Actions/);
});

test('Employers appears with the first employer', () => {
  assert.equal(looks(nextState(empty, none), 'employers').shown, false);
  assert.deepEqual(looks(nextState(empty, {...none, employers: true}), 'employers'), {shown: true, dot: true});
});

test('More lists the hidden pages with when they unlock, counts them, and is gone at 0', () => {
  const names = state => stillLocked(state).map(page => page.name);
  assert.deepEqual(names(empty), ['interviews', 'calendar', 'reports', 'employers']);
  assert.ok(stillLocked(empty).every(page => page.when && page.label && page.icon));
  assert.deepEqual(stillLocked(empty).map(page => page.when), ['after your first application', 'with interviews', 'after your first week', 'after your first employer search']);
  const applied = nextState(empty, {...none, applied: true});
  assert.deepEqual(names(applied), ['reports', 'employers']);   // Calendar unlocks with Interviews
  assert.equal(stillLocked(nextState(applied, {applied: true, weeklyReport: true, employers: true})).length, 0);
  assert.deepEqual(names(nextState(empty, none, 'calendar')), ['reports', 'employers']);   // opened from More: it and its tab-mate join the menu
});

test('every progressive page has a More entry, and More is in the markup closed, with its state remembered', () => {
  for (const name of Object.keys(PROGRESSIVE)) assert.ok(stillLocked(empty).some(page => page.name === name), name);
  const html = read('index.html');
  assert.match(html, /id="nav-more" hidden>/);
  assert.match(html, /id="nav-more-head" aria-expanded="false"/);
  assert.match(read('pages/menu.js'), /jp\.menu\.more/);
  assert.match(html, /<button class="nav" data-view="employers" id="nav-employers" hidden>/);
});

test('the palette does not list the More rows as pages (they are not .nav buttons)', () => {
  assert.doesNotMatch(read('pages/menu.js'), /className: 'nav[ '"]/);
});

test('the tour: five stops in order, only those on screen, shown once', () => {
  assert.deepEqual(STOPS.map(stop => stop.id), ['focus', 'jobs', 'applying', 'actions', 'more']);
  assert.deepEqual(stopsFor(selector => !selector.includes('more')).map(stop => stop.id), ['focus', 'jobs', 'applying', 'actions']);
  const store = new Map(), storage = {getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value)};
  assert.equal(seen(storage), false);
  markSeen(storage);
  assert.equal(seen(storage), true);
  assert.equal(seen({getItem: () => { throw new Error('blocked'); }}), true);   // blocked storage: never nag
  for (const stop of STOPS) assert.ok(read('index.html').includes(stop.target.startsWith('#') ? `id="${stop.target.slice(1)}"` : `data-view="${stop.target.match(/data-view="([a-z]+)"/)[1]}"`), stop.id);
});
