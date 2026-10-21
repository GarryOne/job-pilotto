// The Pro plan in the app (lib/plan.js, lib/app-allowance.js, renderer/plan-view.js, license chip): the site's answer kept 14 days, Pro lifts the limit, the credit is a percent,
// credit gone means no free fallback, and with the plan off nothing about Pro shows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {GRACE_DAYS, OFF, createPlan} from '../lib/plan.js';
import {setSiteOff} from '../lib/recipes.js';
import {createAppAllowance} from '../lib/app-allowance.js';
import {chip} from '../renderer/license-chip.js';
import {NOTES, OWN_KEY, TOPUPS, TOPUP_NOTE, planView, warnNow} from '../renderer/plan-view.js';
import {planLine} from '../renderer/plan-line.js';

const storage = (settings = {}) => { let s = settings; return {settings: () => s, saveSettings: p => { s = {...s, ...p}; }, secret: () => '', setSecret() {}}; };
const answer = (status, body = {}) => async url => (String(url).endsWith('/install-token') ? Response.json({ok: true, token: 'tok'}) : new Response(JSON.stringify({ok: true, ...body}), {status}));
const DAY = 86400000;

test('off until the site says otherwise; a 404 means the plan is off there', async () => {
  const st = storage(), plan = createPlan(st, {fetcher: answer(404)});
  assert.deepEqual(plan.state(), OFF);
  assert.equal((await plan.refresh()).mode, 'off');
});

test('the site\'s answer is kept; offline it stands for 14 days, then the person is Free again', async () => {
  let t = 1_000_000;
  const st = storage(), up = createPlan(st, {fetcher: answer(200, {plan: 'pro', mode: 'test', creditPercent: 70, warn: null}), now: () => t});
  assert.deepEqual([(await up.refresh()).plan, up.state().creditPercent], ['pro', 70]);
  const down = createPlan(st, {fetcher: async () => { throw new Error('offline'); }, now: () => t + 5 * DAY});
  assert.equal((await down.refresh()).plan, 'pro', 'offline: the last answer stands');
  const late = createPlan(st, {now: () => t + (GRACE_DAYS + 1) * DAY});
  assert.deepEqual([late.state().plan, late.state().stale], ['free', true]);
});

test('not a regular install (tests, e2e): the site is never asked and Pro never shows', async () => {
  setSiteOff('test');
  try {
    let asked = false;
    const plan = createPlan(storage({plan: {at: Date.now(), status: {plan: 'pro', mode: 'live'}}}), {fetcher: async () => { asked = true; return new Response('{}'); }});
    assert.deepEqual(await plan.refresh(), OFF);
    assert.equal(plan.state().mode, 'off');
    assert.equal((await plan.checkout('pro')).ok, false);
    assert.equal(asked, false);
  } finally { setSiteOff(''); }
});

test('checkout asks the site with this install\'s token and returns the payment page', async () => {
  const seen = [], plan = createPlan(storage({telemetryId: 'inst-1'}), {fetcher: async (url, init) => { seen.push({url: String(url), init}); return String(url).endsWith('/install-token') ? Response.json({ok: true, token: 'tk'}) : Response.json({ok: true, url: 'https://pay.test/x'}); }});
  assert.deepEqual(await plan.checkout('topup5'), {ok: true, url: 'https://pay.test/x'});
  const call = seen.find(item => item.url.endsWith('/api/pro/checkout'));
  assert.equal(call.init.headers['x-api-key'], 'JPF1.inst-1.tk');
  assert.equal(JSON.parse(call.init.body).kind, 'topup5');
  const refused = createPlan(storage(), {fetcher: async url => (String(url).endsWith('/install-token') ? Response.json({ok: true, token: 'tk'}) : Response.json({ok: false, error: 'Payments are not available right now.'}, {status: 503}))});
  assert.deepEqual(await refused.checkout('pro'), {ok: false, error: 'Payments are not available right now.'});
});

// A fake app around createAppAllowance: license state, plan answer and settings.
const app = ({plan, license = {}, settings = {}} = {}) => {
  const st = storage({...settings, ...(plan ? {plan: {at: Date.now(), status: plan}} : {})}), sent = [];
  const out = createAppAllowance({DEMO: false, getLicense: () => ({state: () => ({licensed: false, license: null, used: 25, limit: 20, daysLeft: 0, ended: true, ...license})}), log() {}, getStorage: () => st, getTelemetry: () => null, toWindow: (...args) => sent.push(args)});
  return {...out, sent, st};
};

test('Pro lifts the limit: licensed, never ended, nothing blocked after the free period; a free install after it is blocked', () => {
  const pro = app({plan: {plan: 'pro', mode: 'test', creditPercent: 80, warn: null}});
  assert.deepEqual([pro.licenseState().licensed, pro.licenseState().license.kind, pro.licenseState().ended, pro.licenseState().proMode], [true, 'pro', false, 'test']);
  assert.equal(pro.allowanceBlock(), null);
  const free = app({plan: {plan: 'free', mode: 'test', offer: {price: '29', launch: '19'}}});
  assert.equal(free.allowanceBlock().allowance, true, 'the free period is over: new work pauses, any engine');
  assert.deepEqual(free.licenseState().offer, {price: '29', launch: '19'});
  assert.equal(app({}).licenseState().proMode, undefined, 'plan off: nothing about Pro');
});

test('credit used up: our AI starts nothing new (top up or own key); an own key and any other credit level are never blocked', () => {
  const gone = {plan: 'pro', mode: 'test', creditPercent: 0, warn: 0};
  const onFree = app({plan: gone, settings: {aiFree: true}}).allowanceBlock();
  assert.equal(onFree.credit, true); assert.match(onFree.error, /Add credit/); assert.match(onFree.error, /own AI key/);
  assert.equal(app({plan: gone, settings: {aiEngine: 'cli'}}).allowanceBlock(), null, 'an own key stays unlimited');
  for (const warn of [null, 30, 10]) assert.equal(app({plan: {plan: 'pro', mode: 'test', creditPercent: 20, warn}, settings: {aiFree: true}}).allowanceBlock(), null, `warn ${warn}`);
});

test('the plan card: nothing when off; Upgrade for Free with the price from the site; the credit bar, the warning and the top-ups for Pro; never dollars for the credit', () => {
  // 17 Oct 2026: the credit warning names the level crossed, never a different number from the bar; the bullets say hosted keeps it always on.
  assert.match(NOTES[30], /under 30%/); assert.match(NOTES[10], /under 10%/);
  assert.ok(planView({mode: 'test', plan: 'free'}).included.includes('Always on: new matches every morning, even when your Mac is off'));
  assert.ok(!planView({mode: 'test', plan: 'free'}).included.some(line => /Your data stays yours/.test(line)));
  assert.equal(planView({mode: 'off'}), null); assert.equal(planView(), null);
  const up = planView({mode: 'test', plan: 'free', offer: {price: '29', launch: '19'}});
  assert.equal(up.price, '$19 one-time, no subscription. Launch price while it lasts; usually $29.');
  assert.match(planView({mode: 'live', plan: 'free', offer: {price: '29', launch: ''}}).price, /^\$29 one-time, no subscription\.$/);
  assert.doesNotMatch(JSON.stringify(up), /lifetime/i);
  const pro = planView({mode: 'test', plan: 'pro', creditPercent: 25, warn: 30});
  assert.deepEqual([pro.label, pro.tone, pro.note], ['AI credit: 25% left', 'info', NOTES[30]]);
  assert.equal(planView({mode: 'test', plan: 'pro', creditPercent: 5, warn: 10}).tone, 'bad');
  assert.equal(planView({mode: 'test', plan: 'pro', creditPercent: 80, warn: null}).note, OWN_KEY);
  for (const text of [pro.label, ...Object.values(NOTES), OWN_KEY]) assert.doesNotMatch(text, /\$\d|applications? left|neuron/i, text);
  assert.deepEqual(TOPUPS.map(top => [top.price, top.credit]), [['$5', '$2.80'], ['$10', '$5.80'], ['$20', '$11.80']]);
  for (const top of TOPUPS) assert.ok(TOPUP_NOTE.includes(`${top.price} adds ${top.credit}`), `the note says what ${top.price} buys`);
});

test('the top-up credits shown here are the site\'s (when the site\'s table is in this checkout)', () => {
  const file = new URL('../../site/src/pro-pay.js', import.meta.url);
  if (!fs.existsSync(file)) return;   // PR 2 (payments) not merged yet: the check starts with it
  const source = fs.readFileSync(file, 'utf8');
  for (const [kind, micro] of [['topup5', 2_800_000], ['topup10', 5_800_000], ['topup20', 11_800_000]]) assert.ok(source.includes(`${kind}: ${micro.toLocaleString('en-US').replaceAll(',', '_')}`), `${kind} credit matches api/pro-pay.js`);
});

test('warnings are said once each (30, 10, used up) and start over when the credit is above 30% again', () => {
  let said = [], got = [];
  for (const warn of [null, 30, 30, 10, 10, 0, 0, null, 30]) { const next = warnNow(warn, said); said = next.said; got.push(next.say); }
  assert.deepEqual(got, [null, 30, null, 10, null, 0, null, null, 30]);
});

test('the sidebar counter for Pro is the credit bar, red from 10%; the plan line goes when the plan is on', () => {
  const pro = {licensed: true, license: {kind: 'pro'}, pro: {creditPercent: 70, warn: null}, used: 30, limit: 20};
  assert.deepEqual([chip(pro).plan, chip(pro).text, chip(pro).tone, chip(pro).percent], ['Pro', 'AI credit 70%', 'info', 70]);
  assert.equal(chip({...pro, pro: {creditPercent: 8, warn: 10}}).tone, 'bad');
  assert.equal(chip({licensed: true, license: {kind: 'founder'}}), null, 'a founder key still shows no counter');
  assert.ok(planLine({limit: 20})); assert.equal(planLine({limit: 20, proMode: 'test'}), null);
});

test('every place that shows the plan is wired: the panel, the palette entries (only when on), the IPC pair, the card hidden by default', () => {
  const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  assert.match(read('../renderer/index.html'), /id="setting-plan" hidden>/);
  const nav = read('../renderer/pages/nav.js');
  assert.match(nav, /\['test', 'live'\]\.includes\(shared\.plan\?\.mode\)/);
  for (const label of ['Plan and AI credit', 'Add AI credit', 'Upgrade to Pro']) assert.ok(nav.includes(`'${label}'`), label);
  assert.match(read('../preload.cjs'), /planState: call\('planState'\), planCheckout: call\('planCheckout'\)/);
});
