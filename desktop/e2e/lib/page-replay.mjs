/* global document */
// Layer 2 of applying reliability (spec: docs/superpowers/specs/2026-10-10-applying-reliability-layers.md): recorded pages replayed with the REAL extension,
// offline. A case (e2e/recorded/<shape>-<n>/case.json) serves its pages at their real addresses (context.route), answers the app's AI calls from the case
// (no AI, no network), opens the first page as an application tab (`start: "panel"`: then presses the panel's Fill) and checks `expect`. Isolation: lib/real-extension.mjs (fake applicant, stub app).
// Guard: e2e/test/recorded-pages.test.mjs runs every case; desktop/test/replay-privacy.test.js keeps personal data out of the cases.
import fs from 'node:fs';
import path from 'node:path';
import {E2E} from './app.mjs';
import {startRealExtension} from './real-extension.mjs';

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
  return Object.fromEntries(Object.entries(item.ai || {}).map(([route, body]) => [route, Array.isArray(body) ? sent => pick(body, sent) : body.byHost ? text => { const entry = body.byHost[hostOf(text)]; return Array.isArray(entry) ? pick(entry, text) : entry || {}; } : () => body]));
}
export const caseHosts = item => [...new Set(item.pages.map(page => new URL(page.url).host))];
export const caseFiles = item => new Map(item.pages.map(page => [pathKey(page.url), fs.readFileSync(path.join(item.dir, page.file), 'utf8')]));
export const isExtensionPage = open => open.url().startsWith('chrome-extension://');

// The case's checks on ITS tab. scope: {run, page (the tab), pages() (the case's non-extension tabs), mine() (requests that are the case's: told/asked/judged count only these, so a
// parallel tab's request never satisfies a check), all() (every request: notTold counts all, so a parallel tab can only add a failure, never hide one), opened() (tabs opened during the run)}.
// -> {ok, failures: [why], seen: {tabs, opened}}. expect: {told: [log words], notTold: [..], maxTabs, maxNewTabs (tabs opened during the run), attached: [selector], filled: [selector], pressed: [selector] (a pressable button, aria-pressed=true), asked: [question] (listed in the fields of an /extension/answer request: the reader saw it), empty: [selector], gone: [selector], seconds}
export async function judgeCase(item, scope) {
  const {run, mine, all} = scope, failures = [];
  if (item.start === 'panel') await run.fillWithPanel(scope.page);   // a form page's fill starts from the panel's Fill button (as the person, or the app's start signal, would)
  const expect = item.expect || {}, deadline = Date.now() + (expect.seconds || 40) * 1000;
  const page = () => scope.pages().at(-1) || scope.page;
  const told = (word, list) => list().some(request => request.body.includes(word));
  const checks = {
    told: word => told(word, mine),
    attached: selector => page().evaluate(css => (document.querySelector(css)?.files?.length || 0) > 0, selector).catch(() => false),
    filled: selector => page().evaluate(css => !!document.querySelector(css)?.value, selector).catch(() => false),
    pressed: selector => page().evaluate(css => document.querySelector(css)?.getAttribute('aria-pressed') === 'true', selector).catch(() => false),
    asked: label => mine().some(request => request.route === '/extension/answer' && request.body.split('"page_text"')[0].includes(`"label":${JSON.stringify(label)}`)),
    // What the extension showed the form judge (form-ready.js: /extension/account-judge, phase form): "<label>:<state>" of one control of the sketch it sent.
    judged: spec => mine().some(request => { try { const body = JSON.parse(request.body); return request.route === '/extension/account-judge' && body.phase === 'form' && body.sketch.controls.some(control => `${control.label}:${control.state}` === spec); } catch { return false; } }),
    gone: selector => page().evaluate(css => !document.querySelector(css)?.getClientRects().length, selector).catch(() => false),
  };
  const pending = Object.entries(checks).flatMap(([kind, check]) => (expect[kind] || []).map(arg => ({kind, arg, check})));
  while (pending.length && Date.now() < deadline) {
    for (const one of [...pending]) if (await one.check(one.arg)) pending.splice(pending.indexOf(one), 1);
    if (pending.length) await wait(500);
  }
  if (!Object.keys(checks).some(kind => (expect[kind] || []).length)) await wait(Math.max(0, deadline - Date.now()));   // only "must not happen" checks: watch the whole window
  for (const left of pending) failures.push(`${left.kind}: ${left.arg}`);
  for (const word of expect.notTold || []) if (told(word, all)) failures.push(`notTold: ${word}`);
  for (const selector of expect.empty || []) if (await checks.filled(selector)) failures.push(`empty: ${selector}`);
  const tabs = scope.pages().length, opened = scope.opened();
  if (expect.maxTabs != null && tabs > expect.maxTabs) failures.push(`maxTabs: ${tabs} > ${expect.maxTabs}`);
  if (expect.maxNewTabs != null && opened > expect.maxNewTabs) failures.push(`maxNewTabs: ${opened} > ${expect.maxNewTabs}`);
  if (process.env.REPLAY_LOG) for (const request of mine().filter(one => one.route === '/extension/log')) {   // REPLAY_LOG=1: the extension's own decision lines, to read why a case failed (what the failure list cannot tell)
    try { for (const entry of JSON.parse(request.body).entries) console.log(`  [extension] ${entry.text} ${JSON.stringify(entry.fields)}`); } catch { /* a body cut at the recording limit */ }
  }
  return {ok: !failures.length, failures, seen: {tabs, opened}};
}

// One case in its own browser (JP_REPLAY_TABS=1, and the run alone after a failure in parallel): the same checks over every request of that browser.
export async function runCase(item, {extensionDir} = {}) {
  const run = await startRealExtension({extensionDir, cv: item.cv !== false, allowAllSites: true, answer: answerFor(item), offline: true});   // offline: nothing but the case's pages
  const pages = caseFiles(item);
  try {
    for (const host of caseHosts(item)) {
      await run.context.route(`https://${host}/**`, route => {
        const body = pages.get(pathKey(route.request().url()));
        return body ? route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body}) : route.fulfill({status: 404, body: ''});
      });
    }
    let opened = 0;   // every tab a page or the extension opened during the run (a tab loop closes the tab behind it: the count at the end stays 1)
    run.context.on('page', open => { if (!open.url().startsWith('chrome-extension://')) opened += 1; });
    await run.page.goto(`${item.pages[0].url}#jobpilotto-fill`, {waitUntil: 'domcontentloaded'});
    const result = await judgeCase(item, {run, page: run.page, pages: () => run.context.pages().filter(open => !isExtensionPage(open)), mine: () => run.requests, all: () => run.requests, opened: () => opened});
    if (!(await run.assertIsolated())) result.failures.push('isolation');
    return {...result, ok: !result.failures.length};
  } finally { await run.close(); }
}
