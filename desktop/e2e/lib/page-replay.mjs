/* global document */
// Layer 2 of applying reliability (spec: docs/superpowers/specs/2026-10-10-applying-reliability-layers.md): recorded pages replayed with the REAL extension,
// offline. A case (e2e/recorded/<shape>-<n>/case.json) serves its pages at their real addresses (context.route), answers the app's AI calls from the case
// (no AI, no network), opens the first page as an application tab (`start: "panel"`: then presses the panel's Fill) and checks `expect`. Isolation: lib/real-extension.mjs (fake applicant, stub app).
// Guard: e2e/test/recorded-pages.test.mjs runs every case; desktop/test/replay-privacy.test.js keeps personal data out of the cases.
import fs from 'node:fs';
import path from 'node:path';
import {E2E} from './app.mjs';
import {startRealExtension} from './real-extension.mjs';
import {fillState} from './extension.mjs';
import {endingOfStuck} from '../../../extension/ladder/endings.js';
import {movesFromRequests} from './ladder-moves.mjs';

export const REPLAY_DIR = path.join(E2E, 'recorded');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const pathKey = url => { const parsed = new URL(url); return `${parsed.host}${parsed.pathname}`.replace(/\/$/, ''); };

export function loadCases(dir = REPLAY_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => fs.existsSync(path.join(dir, name, 'case.json'))).sort()
    .map(name => ({name, dir: path.join(dir, name), ...JSON.parse(fs.readFileSync(path.join(dir, name, 'case.json'), 'utf8'))}));
}

// The AI answers of a case as the stand-in's `answer` map: a route's stubbed answer is one body, or a list of {when: {field: value}, answer} picked by what the extension sent (the ladder: an unsure answer, then a digest request); the last entry is the default.
export function answerFor(item) {
  const pick = (list, sent) => { let request = {}; try { request = JSON.parse(sent || '{}'); } catch { /* not JSON: the default */ } const sees = entry => Object.entries(entry.when || {}).every(([field, value]) => request[field] === value) && (entry.whenFilled || []).every(field => Array.isArray(request[field]) && request[field].length > 0) && (entry.whenButtons || []).every(text => (request.buttons || []).includes(text)) && (!entry.whenCandidate || (Array.isArray(request.candidates) && request.candidates.some(item => item?.text === entry.whenCandidate))); return (list.find(sees) || list.at(-1)).answer; };   // whenFilled: the request carried that list (a frame candidate), so the answer may name it; whenButtons: the sketch listed those buttons, so the answer may name one (a modal's control beyond the sketch's cap)
  // ...or {"byHost": {<host>: answer}} when a journey crosses pages that the AI answers differently (the request's `url` says which).
  const hostOf = text => { try { return new URL(JSON.parse(text).url).hostname; } catch { return ''; } };
  // An answer with "_delayMs" comes that much later (a slow AI on a real run: the fill waits for its answers while the page is half filled); the field itself is never sent.
  // A route's answer may also be a function of the request body (sync or async): widget-zoo.mjs --model answers the fill check with the real model.
  const late = fn => sent => { const found = fn(sent); const ms = Number(found?._delayMs) || 0; if (!ms) return found; const {_delayMs, ...rest} = found; return new Promise(resolve => setTimeout(() => resolve(rest), ms)); };
  return Object.fromEntries(Object.entries(item.ai || {}).map(([route, body]) => [route, late(typeof body === 'function' ? body : Array.isArray(body) ? sent => pick(body, sent) : body.byHost ? text => { const entry = body.byHost[hostOf(text)]; return Array.isArray(entry) ? pick(entry, text) : entry || {}; } : () => body)]));
}
export const caseHosts = item => [...new Set(item.pages.map(page => new URL(page.url).host))];
export const caseFiles = item => new Map(item.pages.map(page => [pathKey(page.url), fs.readFileSync(path.join(item.dir, page.file), 'utf8')]));
// A page's HTTP status per load, in turn (case.json pages[].status: 503 or [503, 200]; the last repeats; 200 when absent): a site that errors, then answers (the site_broken
// ending, extension/ladder/site-broken.js). answerPage serves a case page with it: a status that is not 2xx gets a bare error page, as a site's server sends.
export const caseStatuses = item => new Map(item.pages.filter(page => page.status != null).map(page => [pathKey(page.url), [].concat(page.status)]));
export function answerPage(route, files, statuses = new Map()) {
  const key = pathKey(route.request().url()), body = files.get(key);
  if (!body) return route.fulfill({status: 404, body: ''});
  const list = statuses.get(key), status = !list ? 200 : list.length > 1 ? list.shift() : list[0];
  return route.fulfill({status, contentType: 'text/html; charset=utf-8', body: status >= 200 && status < 300 ? body : `<!doctype html><title>${status}</title><h1>${status}</h1>`});
}
export const isExtensionPage = open => open.url().startsWith('chrome-extension://');

// The case's checks on ITS tab. scope: {run, page (the tab), pages() (the case's non-extension tabs), mine() (requests that are the case's: told/asked/judged count only these, so a
// parallel tab's request never satisfies a check), all() (every request: notTold counts all, so a parallel tab can only add a failure, never hide one), opened() (tabs opened during the run)}.
// -> {ok, failures: [why], seen: {tabs, opened}, moves()}. expect: {told: [log words], stuck: ['<why>' | '<why>|<need start>'] (a "can't reach" report), ending: [ending] (what the report names: extension/ladder/endings.js), notTold: [..], maxTabs, maxNewTabs (tabs opened during the run), attached: [selector], filled: [selector], kept: [selector] (still holds a value after the page settled), valueHas: ["selector|digits"] (the box holds those digits), pressed: [selector] (a pressable button, aria-pressed=true), chosen: [selector] (a choice option that reads as on: aria-checked/aria-pressed true, or a checked native radio/checkbox), asked: [question] (listed in the fields of an /extension/answer request: the reader saw it), empty: [selector], gone: [selector], notJudged: ["<label>:<state>"] (the form judge was never sent that), present: [selector] (an element matches: a state a widget shows only by a class or attribute), seconds}
export async function judgeCase(item, scope) {
  const {run, mine, all} = scope, failures = [];
  if (item.start === 'panel') await run.fillWithPanel(scope.page);   // a form page's fill starts from the panel's Fill button (as the person, or the app's start signal, would)
  const expect = item.expect || {}, deadline = Date.now() + (expect.seconds || 40) * 1000;
  const page = () => scope.pages().at(-1) || scope.page;
  // The request-based checks over one list of requests (the strict list is only the case's own, the loose one adds lines no case's host names: see replay-browser.mjs).
  // The "can't reach" reports the extension sent the app (/extension/event, type stuck): {why, needs}.
  const stuckReports = list => list().filter(request => request.route === '/extension/event').map(request => { try { return JSON.parse(request.body); } catch { return null; } }).filter(body => body?.type === 'stuck');
  const requestChecks = list => ({
    told: word => list().some(request => request.body.includes(word)),
    // stuck: ["<why>"] or ["<why>|<the start of what the person is told>"]: a "can't reach" report with that reason (and need).
    stuck: spec => { const [why, needs = ''] = spec.split('|'); return stuckReports(list).some(body => body.why === why && String(body.needs || '').startsWith(needs)); },
    // ending: ["<ending>"]: a "can't reach" report names that ending of the outcome contract (extension/ladder/endings.js endingOfStuck).
    ending: name => stuckReports(list).some(body => endingOfStuck(body.why, body.needs) === name),
    asked: label => list().some(request => request.route === '/extension/answer' && request.body.split('"page_text"')[0].includes(`"label":${JSON.stringify(label)}`)),
    // What the extension showed the form judge (form-ready.js: /extension/account-judge, phase form): "<label>:<state>" of one control of the sketch it sent.
    judged: spec => list().some(request => { try { const body = JSON.parse(request.body); return request.route === '/extension/account-judge' && body.phase === 'form' && body.sketch.controls.some(control => `${control.label}:${control.state}` === spec); } catch { return false; } }),
    // What sits on top of the page, as the sketch the extension sent the form judge or the page-kind ask says (extension/on-top.js): the layer's shape.
    onTop: shape => list().some(request => { try { const body = JSON.parse(request.body); return (request.route === '/extension/account-judge' && body.phase === 'form' ? body.sketch : request.route === '/extension/page-kind' ? body : null)?.onTop?.shape === shape; } catch { return false; } }),
  });
  const checks = {
    ...requestChecks(mine),
    attached: selector => page().evaluate(css => (document.querySelector(css)?.files?.length || 0) > 0, selector).catch(() => false),
    filled: selector => page().evaluate(css => !!document.querySelector(css)?.value, selector).catch(() => false),
    pressed: selector => page().evaluate(css => document.querySelector(css)?.getAttribute('aria-pressed') === 'true', selector).catch(() => false),
    chosen: selector => page().evaluate(css => { const el = document.querySelector(css); return !!el && (['aria-checked', 'aria-pressed'].some(name => el.getAttribute(name) === 'true') || el.checked === true || !!el.querySelector('input:checked')); }, selector).catch(() => false),
    // valueHas: ["<selector>|<digits>"]: the box's value still holds those digits (a phone widget that went back to its own country code does not).
    valueHas: spec => page().evaluate(([css, digits]) => (document.querySelector(css)?.value || '').replace(/\D/g, '').includes(digits), spec.split('|')).catch(() => false),
    // valueIs: ["<selector>|<text>"]: the box holds exactly that (a first-name box that got the family name fails: 12 Oct 2026, labels the page tied to no box).
    valueIs: spec => page().evaluate(([css, text]) => (document.querySelector(css)?.value || '').trim() === text, spec.split('|')).catch(() => false),
    gone: selector => page().evaluate(css => !document.querySelector(css)?.getClientRects().length, selector).catch(() => false),
    present: selector => page().evaluate(css => !!document.querySelector(css), selector).catch(() => false),
  };
  const pending = Object.entries(checks).flatMap(([kind, check]) => (expect[kind] || []).map(arg => ({kind, arg, check})));
  while (pending.length && Date.now() < deadline) {
    for (const one of [...pending]) if (await one.check(one.arg)) pending.splice(pending.indexOf(one), 1);
    if (pending.length) await wait(500);
  }
  if (!Object.keys(checks).some(kind => (expect[kind] || []).length)) await wait(Math.max(0, deadline - Date.now()));   // only "must not happen" checks: watch the whole window
  for (const left of pending) failures.push(`${left.kind}: ${left.arg}`);
  for (const word of expect.notTold || []) if (requestChecks(all).told(word)) failures.push(`notTold: ${word}`);
  for (const spec of expect.notJudged || []) if (requestChecks(all).judged(spec)) failures.push(`notJudged: ${spec}`);   // the form judge was never shown that control in that state
  for (const selector of expect.empty || []) if (await checks.filled(selector)) failures.push(`empty: ${selector}`);
  // kept: a box the fill typed must still hold its value once the page has had its say (an upload's own autofill rewrites boxes a moment later): read after the page settled.
  if ((expect.kept || []).length) { await wait(expect.keptAfter || 2500); for (const selector of expect.kept) if (!(await checks.filled(selector))) failures.push(`kept: ${selector} is empty after the page settled`); }
  const tabs = scope.pages().length, opened = scope.opened();
  if (expect.maxTabs != null && tabs > expect.maxTabs) failures.push(`maxTabs: ${tabs} > ${expect.maxTabs}`);
  if (expect.maxNewTabs != null && opened > expect.maxNewTabs) failures.push(`maxNewTabs: ${opened} > ${expect.maxNewTabs}`);
  if (process.env.REPLAY_LOG) for (const request of mine().filter(one => one.route === '/extension/log')) {   // REPLAY_LOG=1: the extension's own decision lines, to read why a case failed (what the failure list cannot tell)
    try { for (const entry of JSON.parse(request.body).entries) console.log(`  [extension ${item.name}] ${entry.text} ${JSON.stringify(entry.fields)}`); } catch { /* a body cut at the recording limit */ }
  }
  // A check that only a line no case's host names satisfied (it could be another tab's): the pass must be confirmed alone before it counts.
  const confirm = [];
  if (!failures.length && scope.strict) {
    const strict = requestChecks(scope.strict);
    for (const kind of ['told', 'asked', 'judged', 'onTop', 'stuck', 'ending']) for (const arg of expect[kind] || []) if (!strict[kind](arg)) confirm.push(`${kind}: ${arg}`);
  }
  return {ok: !failures.length, failures, confirm, seen: {tabs, opened}, moves: () => movesFromRequests(mine())};   // the ladder moves the case's pages confirmed (lib/ladder-moves.mjs), read once the run is over: a report can land after the judgment
}

// A case's checks can pass while its fill still runs; the fill's last reports (the moves it confirmed: lib/ladder-moves.mjs) land after it. Before a case's tab is closed it waits for the
// page's own fill state to leave "running", at most `ms`, then the reports' flight time. A page with no fill state is not waited for. The checks are not changed.
export async function fillSettled(page, ms = 4000) {
  let state = await fillState(page).catch(() => null);
  for (const end = Date.now() + ms; state?.state === 'running' && Date.now() < end; state = await fillState(page).catch(() => null)) await wait(200);
  if (state) await wait(300);
}

// One case in its own browser (JP_REPLAY_TABS=1, and the run alone after a failure in parallel): the same checks over every request of that browser.
export async function runCase(item, {extensionDir} = {}) {
  const run = await startRealExtension({extensionDir, cv: item.cv !== false, allowAllSites: true, answer: answerFor(item), offline: true});   // offline: nothing but the case's pages
  const pages = caseFiles(item), statuses = caseStatuses(item);
  try {
    for (const host of caseHosts(item)) await run.context.route(`https://${host}/**`, route => answerPage(route, pages, statuses));
    let opened = 0;   // every tab a page or the extension opened during the run (a tab loop closes the tab behind it: the count at the end stays 1)
    run.context.on('page', open => { if (!open.url().startsWith('chrome-extension://')) opened += 1; });
    await run.page.goto(`${item.pages[0].url}#jobpilotto-fill`, {waitUntil: 'domcontentloaded'});
    const result = await judgeCase(item, {run, page: run.page, pages: () => run.context.pages().filter(open => !isExtensionPage(open)), mine: () => run.requests, all: () => run.requests, opened: () => opened});
    if (!(await run.assertIsolated())) result.failures.push('isolation');
    await fillSettled(run.page);
    return {...result, ok: !result.failures.length};
  } finally { await run.close(); }
}
