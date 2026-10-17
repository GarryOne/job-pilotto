// The Pro waitlist on Settings → Plan (17 Oct 2026): Free is marked "Your plan", the Pro card has the button, the dialog posts to the site (a fake here, never the live one),
// the joined state replaces the button, the ⌘K entry exists, and the one payment switch is off.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {joinProWaitlist} from '../lib/pro-waitlist.js';
import {PRO_CHECKOUT, showsProWaitlist} from '../renderer/plan-line.js';
import {INCLUDED} from '../renderer/plan-view.js';

const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const storage = () => { let s = {}; return {settings: () => s, saveSettings: p => { s = {...s, ...p}; }}; };

test('the dialog posts the address to the waitlist as source "app" and the install remembers it', async () => {
  const calls = [], store = storage();
  const fetcher = async (url, init) => { calls.push([String(url), init.method, JSON.parse(init.body)]); return Response.json({ok: true}); };
  const result = await joinProWaitlist(store, ' Ada@Example.com ', {fetcher, now: () => 5});
  assert.deepEqual(result, {ok: true, email: 'ada@example.com'});
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /\/api\/waitlist$/);
  assert.deepEqual(calls[0].slice(1), ['POST', {email: 'ada@example.com', source: 'app'}]);
  assert.deepEqual(store.settings().proWaitlist, {email: 'ada@example.com', at: 5});
});

test('a bad address, a refusal and an unreachable site are told and nothing is remembered', async () => {
  const store = storage(), never = async () => { throw new Error('must not be called'); };
  assert.equal((await joinProWaitlist(store, 'nope', {fetcher: never})).ok, false);
  const limited = await joinProWaitlist(store, 'a@b.co', {fetcher: async () => Response.json({ok: false, error: 'Too many sign-ups from here. Try again in an hour.'}, {status: 429})});
  assert.deepEqual(limited, {ok: false, error: 'Too many sign-ups from here. Try again in an hour.'});
  assert.equal((await joinProWaitlist(store, 'a@b.co', {fetcher: async () => { throw new Error('offline'); }})).ok, false);
  assert.equal(store.settings().proWaitlist, undefined);
});

test('the Plan page: Free is the current plan, Pro is a card beside it, the card shows only while Pro is off', () => {
  const license = read('../renderer/pages/license.js'), html = read('../renderer/index.html'), card = read('../renderer/pages/plan-waitlist.js');
  assert.match(license, /'Free'/);
  assert.match(license, /'Your plan'/, 'the Free card is marked as the current plan');
  assert.match(html, /id="setting-pro-waitlist"/);
  assert.equal(showsProWaitlist({}), true);
  assert.equal(showsProWaitlist({proMode: 'live'}), false, 'with Pro open the real plan card takes its place');
  assert.equal(showsProWaitlist({licensed: true}), false);
  for (const text of INCLUDED) assert.ok(card.includes('INCLUDED'), text);   // only the decided list (plan-view.js), none of its own
  assert.match(card, /Join the Pro waitlist/);
  assert.match(card, /You're on the waitlist \(\$\{joined\}\)/);
  assert.match(card, /We\\'ll e-mail you once when Pro opens\. Nothing else\./);
});

test('payments are off: one switch, and the button joins the waitlist', () => {
  assert.equal(PRO_CHECKOUT, false);
  assert.match(read('../renderer/pages/plan-waitlist.js'), /PRO_CHECKOUT \? window\.pilot\.planCheckout\('pro'\) : openWaitlist\(\)/);
});

test('the ⌘K palette has "Join the Pro waitlist", the IPC and the preload bridge exist', () => {
  assert.match(read('../renderer/pages/nav.js'), /'Join the Pro waitlist'/);
  assert.match(read('../lib/app-meta-handlers.js'), /ipcMain\.handle\('proWaitlistJoin'/);
  assert.match(read('../preload.cjs'), /proWaitlistJoin: call\('proWaitlistJoin'\)/);
});
