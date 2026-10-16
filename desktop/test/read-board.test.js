// "Read this board" (owner, 16 Oct 2026): a job list behind a login read through a tab the app opens in the person's own Chrome and holds for their Read.
// The app opens it with #jp-board-<ticket>, runs no clock while the person signs in, and never reads before they press Read. Fixture addresses only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {BOARD_WAIT_MS, boardSite, done, runAll, stepOf, waitingFor} from '../lib/visits.js';
import {popupMode, readTabs} from '../../extension/tab-pages.js';
import {popupControls} from '../../extension/popup-controls.js';
import {validBoard} from '../renderer/board-address.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const ticketOf = url => /-([a-z0-9]{8})$/.exec(url)[1];

test('a board address is an https address with no password in it', () => {
  assert.deepEqual(boardSite('https://www.board.example/jobs/search/?keywords=sre#x'), {name: 'board.example', url: 'https://www.board.example/jobs/search/?keywords=sre', kind: 'board'});
  for (const bad of ['', 'board.example/jobs', 'http://board.example/jobs', 'https://me:secret@board.example/jobs', 'javascript:alert(1)']) assert.equal(boardSite(bad), null, bad);
  assert.equal(validBoard('https://board.example/jobs'), true);
  assert.equal(validBoard('board.example'), false);
});

test('a held board waits with no clock until the person presses Read, then reads, and a sign-in puts it back on hold', async () => {
  const opened = [], lines = [];
  const openTab = url => { opened.push(url); return {ok: true}; };
  const finished = runAll([boardSite('https://board.example/jobs/search')], {hold: true, openTab, waitMs: 5000, quietMs: 40, siteMs: 40, tee: line => lines.push(line)});
  await wait(10);
  assert.match(opened[0], /^https:\/\/board\.example\/jobs\/search#jp-board-[a-z0-9]{8}$/, 'a board mark: the extension reads nothing by itself');
  const ticket = ticketOf(opened[0]);
  await wait(150);   // far past quietMs and siteMs: nobody pressed Read, so nothing is skipped
  assert.ok(lines.some(line => /^⏳ Waiting for you in Chrome: .*press Read/.test(line)), 'the banner says what waits on the person');
  assert.ok(!lines.some(line => /Finding jobs in your browser/.test(line)), 'no "reading" step before Read');
  stepOf({ticket, words: 'reading page 1…'});   // the person pressed Read
  waitingFor({ticket, why: 'login'});   // the board showed a sign-in: held again, clock off
  await wait(150);
  assert.ok(lines.some(line => /sign in to the board in its tab, then press Read/.test(line)));
  stepOf({ticket, words: 'reading page 1…'});   // Read again, signed in
  done({ticket, jobs: 25, added: 25, pages: 1, stopped: 'no next page'});
  const [result] = await finished;
  assert.deepEqual([result.name, result.ok, result.jobs], ['board.example', true, 25]);
  assert.ok(BOARD_WAIT_MS >= 15 * 60 * 1000, 'time to sign in');
});

test('a read board is claimed only by its board mark: its tab is found by ticket, the popup offers the two reads there and nowhere else', () => {
  const url = 'https://board.example/jobs/search#jp-board-ab12cd34';
  assert.deepEqual(readTabs([{id: 7, url}]).reading, {ab12cd34: 7});
  assert.equal(popupMode({url}), 'board');
  assert.deepEqual(popupControls('board').sort(), ['read-as-is', 'read-filter', 'stop']);
  for (const mode of ['fill', 'read', 'browse', 'none']) assert.ok(!popupControls(mode).includes('read-filter'), mode);
});

// The class: every place the extension matches a read mark knows the board mark (a mark one list misses is a tab that is read, or not told about, wrongly).
test('every read-mark pattern in the extension and the app knows #jp-board', () => {
  const background = fs.readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');
  const marked = background.split('\n').filter(line => /#jp-(read|\(\?:read|\(read)/.test(line) && /\.test\(|\.exec\(/.test(line));
  assert.ok(marked.length >= 3, 'the mark patterns in background.js were found');
  for (const line of marked) assert.match(line, /board|#jp-read\(-filter\)\?\(-\[a-z0-9\]\{4,16\}\)\?\$\|#jp-posting/, line.trim().slice(0, 100));   // the one that reads by itself deliberately has no board
  const visit = fs.readFileSync(new URL('../../extension/visit.js', import.meta.url), 'utf8');
  assert.match(visit, /export const MARK = \/#\(jp-read\(-filter\)\?\|jp-board\)/);
  assert.match(visit, /found\[1\] === 'jp-board'/, 'autoRead never starts a board by itself');
  assert.match(fs.readFileSync(new URL('../lib/visits.js', import.meta.url), 'utf8'), /'jp-board'/);
});

test('the card is in ⌘K and off while a read runs, and its dialog never asks for a password', () => {
  const card = fs.readFileSync(new URL('../renderer/pages/actions-board.js', import.meta.url), 'utf8');
  assert.match(card, /data-palette|dataset\.palette = 'board'/);
  assert.match(fs.readFileSync(new URL('../renderer/pages/activity-basics.js', import.meta.url), 'utf8'), /\['visits', '#visits-run', '#visits-at-once', '#board-run'\]/);
  assert.match(fs.readFileSync(new URL('../renderer/pages/nav.js', import.meta.url), 'utf8'), /board: '/);
  assert.doesNotMatch(card, /type: 'password'|type="password"/);
});

// The extension's Read: only a tab the app opened for a board can be started from the popup; any other tab is refused, whatever the popup sends.
test('startBoard refuses a tab that is not a board the app opened, and starts one that is, never reading a login page', async () => {
  const store = {}, ran = [], removed = [];
  const tabs = {1: {id: 1, url: 'https://github.com/x/y'}, 2: {id: 2, url: 'https://board.example/feed'}, 3: {id: 3, url: 'https://board.example/login'}};
  globalThis.chrome = {
    storage: {session: {get: async key => (typeof key === 'string' ? {[key]: store[key]} : {...store}), set: async items => Object.assign(store, items), remove: async key => { delete store[key]; }}, local: {get: async () => ({}), set: async () => {}}},
    tabs: {get: async id => tabs[id], remove: async id => removed.push(id), update: async () => ({})},
    permissions: {contains: async () => true},
    action: {setBadgeText: async () => {}, setTitle: async () => {}},
    runtime: {getPlatformInfo: async () => ({}), sendMessage: async () => ({})},
    scripting: {executeScript: async ({func}) => ran.push(func?.name) && [{result: func?.name === 'extractPage' ? {login: true, cards: [], url: 'https://board.example/login'} : undefined}]},
  };
  const {startBoard} = await import('../../extension/visit.js');
  assert.equal((await startBoard(1, false)).ok, false, 'a GitHub tab is not a board the app opened');
  assert.equal((await startBoard(99, false)).ok, false, 'no such tab');
  store['readmark:3'] = '#jp-board-ab12cd34';   // the app's board tab, now on a sign-in page (the mark was dropped by the redirect)
  const answer = await startBoard(3, true);
  assert.equal(answer.ok, true);
  assert.ok(ran.includes('extractPage'), 'positive control: the page was looked at');
  assert.ok(!ran.some(name => /applyFilters|collectControls|cardsByRecipe/.test(name)), 'on a sign-in page nothing is filtered, typed or read');
  assert.deepEqual(removed, [], 'a sign-in wall keeps the tab: the person signs in, then presses Read again');
  assert.equal(store['readmark:3'], '#jp-board-ab12cd34', 'the board mark is kept for the tab');
  delete globalThis.chrome;
});
