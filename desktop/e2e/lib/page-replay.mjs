/* global document */
// Layer 2 of applying reliability (spec: docs/superpowers/specs/2026-10-10-applying-reliability-layers.md): recorded pages replayed with the REAL extension,
// offline. A case (e2e/recorded/<shape>-<n>/case.json) serves its pages at their real addresses (context.route), answers the app's AI calls from the case
// (no AI, no network), opens the first page as an application tab and checks `expect`. Isolation: lib/real-extension.mjs (fake applicant, stub app).
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

// -> {ok, failures: [why], seen: {tabs, opened}}. expect: {told: [log words], notTold: [..], maxTabs, maxNewTabs (tabs opened during the run), attached: [selector], filled: [selector], empty: [selector], gone: [selector], seconds}
export async function runCase(item, {extensionDir} = {}) {
  const answer = Object.fromEntries(Object.entries(item.ai || {}).map(([route, body]) => [route, () => body]));
  const run = await startRealExtension({extensionDir, cv: item.cv !== false, allowAllSites: true, answer});
  const pages = new Map(item.pages.map(page => [pathKey(page.url), fs.readFileSync(path.join(item.dir, page.file), 'utf8')]));
  const failures = [];
  try {
    for (const host of new Set(item.pages.map(page => new URL(page.url).host))) {
      await run.context.route(`https://${host}/**`, route => {
        const body = pages.get(pathKey(route.request().url()));
        return body ? route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body}) : route.fulfill({status: 404, body: ''});
      });
    }
    let opened = 0;   // every tab a page or the extension opened during the run (a tab loop closes the tab behind it: the count at the end stays 1)
    run.context.on('page', open => { if (!open.url().startsWith('chrome-extension://')) opened += 1; });
    await run.page.goto(`${item.pages[0].url}#jobpilotto-fill`, {waitUntil: 'domcontentloaded'});
    const expect = item.expect || {}, deadline = Date.now() + (expect.seconds || 40) * 1000;
    const page = () => run.context.pages().filter(open => !open.url().startsWith('chrome-extension://')).at(-1) || run.page;
    const checks = {
      told: word => run.told(word),
      attached: selector => page().evaluate(css => (document.querySelector(css)?.files?.length || 0) > 0, selector).catch(() => false),
      filled: selector => page().evaluate(css => !!document.querySelector(css)?.value, selector).catch(() => false),
      gone: selector => page().evaluate(css => !document.querySelector(css)?.getClientRects().length, selector).catch(() => false),
    };
    const pending = Object.entries(checks).flatMap(([kind, check]) => (expect[kind] || []).map(arg => ({kind, arg, check})));
    while (pending.length && Date.now() < deadline) {
      for (const item2 of [...pending]) if (await item2.check(item2.arg)) pending.splice(pending.indexOf(item2), 1);
      if (pending.length) await wait(500);
    }
    if (!Object.keys(checks).some(kind => (expect[kind] || []).length)) await wait(Math.max(0, deadline - Date.now()));   // only "must not happen" checks: watch the whole window
    for (const left of pending) failures.push(`${left.kind}: ${left.arg}`);
    for (const word of expect.notTold || []) if (run.told(word)) failures.push(`notTold: ${word}`);
    for (const selector of expect.empty || []) if (await checks.filled(selector)) failures.push(`empty: ${selector}`);
    const tabs = run.context.pages().filter(open => !open.url().startsWith('chrome-extension://')).length;
    if (expect.maxTabs != null && tabs > expect.maxTabs) failures.push(`maxTabs: ${tabs} > ${expect.maxTabs}`);
    if (expect.maxNewTabs != null && opened > expect.maxNewTabs) failures.push(`maxNewTabs: ${opened} > ${expect.maxNewTabs}`);
    if (!(await run.assertIsolated())) failures.push('isolation');
    return {ok: !failures.length, failures, seen: {tabs, opened}};
  } finally { await run.close(); }
}
