/* global window */
// Checks a candidate recipe on the recorded form pages before it may go to a canary (learning loop, PR 2): in a real browser with the real extension, offline, $0, no AI key.
// Every recorded form that holds the recipe's fingerprint is filled twice with the same answers, once with the recipe and once without; the recipe is REFUSED when it breaks
// something the built-in operator did (a check of the case that held, or the control's own operator outcome) and passes when nothing got worse. No recorded form with the
// fingerprint, or none where the operator ran on it, says so: that is "not checked", never "verified". Guard: desktop/e2e/test/candidate-check.test.mjs. Used by candidate-check.mjs (the CLI the proposer calls).
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {validateRecipe} from '../../../extension/recipe-schema.js';
import {E2E} from './app.mjs';
import {answerFor, answerPage, caseFiles, caseHosts, caseStatuses, caseDelays, isExtensionPage, judgeCase, loadCases} from './page-replay.mjs';
import {startRealExtension} from './real-extension.mjs';

const PAGE_SCRIPTS = ['skeleton.js', 'upload.js', 'controls.js'].map(file => path.join(E2E, '..', '..', 'extension', 'page', file));

// The fingerprints of the controls the operators handle on a recorded page, read by the extension's own page scripts (no extension, no network).
export async function fingerprintsOfCases(cases) {
  const browser = await chromium.launch();
  const found = new Map();
  try {
    for (const item of cases) {
      const page = await browser.newPage();
      try {
        await page.route('**/*', route => (route.request().url() === item.pages[0].url ? answerPage(route, caseFiles(item), caseStatuses(item), caseDelays(item)) : route.abort()));
        await page.goto(item.pages[0].url, {waitUntil: 'domcontentloaded'});
        for (const file of PAGE_SCRIPTS) await page.addScriptTag({content: fs.readFileSync(file, 'utf8')});
        found.set(item.name, await page.evaluate(() => window.__jobPilottoControls?.fingerprints?.() || []).catch(() => []));
      } catch { found.set(item.name, []); } finally { await page.close(); }
    }
  } finally { await browser.close(); }
  return found;
}

// One fill of one case with the given recipes: the case's own failures and what the operators reported for each fingerprint ({fp -> {ok, failed}}).
async function fillOnce(item, recipes, {extensionDir} = {}) {
  const ai = {...(item.ai || {}), '/extension/recipes': {recipes}};
  const run = await startRealExtension({extensionDir, cv: item.cv !== false, allowAllSites: true, answer: answerFor({...item, ai}), offline: true});
  try {
    const pages = caseFiles(item), statuses = caseStatuses(item), delays = caseDelays(item);
    for (const host of caseHosts(item)) await run.context.route(`https://${host}/**`, route => answerPage(route, pages, statuses, delays));
    await run.page.goto(`${item.pages[0].url}#jobpilotto-fill`, {waitUntil: 'domcontentloaded'});
    const result = await judgeCase(item, {run, page: run.page, pages: () => run.context.pages().filter(open => !isExtensionPage(open)), mine: () => run.requests, all: () => run.requests, opened: () => 1});
    const operated = {};
    for (const request of run.requests.filter(one => one.route === '/extension/controls')) {
      let body = {}; try { body = JSON.parse(request.body); } catch { /* not JSON */ }
      for (const entry of Array.isArray(body.items) ? body.items : []) { const sums = operated[entry.fp] ||= {ok: 0, failed: 0}; if (entry.ok) sums.ok++; else sums.failed++; }
    }
    return {failures: result.failures, operated};
  } finally { await run.close(); }
}

// recipe -> {verdict: 'refused' | 'pass' | 'not-exercised' | 'no-recorded-form', rows: [{case, broke, fixed, exercised}], why?}. `cases` and `fingerprints` may be given (tests).
export async function checkCandidate(recipe, {cases = loadCases(), extensionDir, fingerprints} = {}) {
  const checked = validateRecipe(recipe);
  if (!checked.ok) return {verdict: 'refused', rows: [], why: `not a valid recipe: ${checked.error || 'shape'}`};
  const prints = fingerprints || await fingerprintsOfCases(cases);
  const holding = cases.filter(item => (prints.get(item.name) || []).includes(checked.recipe.fingerprint));
  if (!holding.length) return {verdict: 'no-recorded-form', rows: []};
  const rows = [];
  for (const item of holding) {
    const without = await fillOnce(item, {}, {extensionDir});
    const withIt = await fillOnce(item, {[checked.recipe.fingerprint]: checked.recipe}, {extensionDir});
    const own = withIt.operated[checked.recipe.fingerprint] || {ok: 0, failed: 0}, base = without.operated[checked.recipe.fingerprint] || {ok: 0, failed: 0};
    const worse = own.failed > base.failed || own.ok < base.ok;
    const broke = [...withIt.failures.filter(line => !without.failures.includes(line)), ...(worse ? [`operator: ${own.ok} ok / ${own.failed} failed with the recipe, ${base.ok} / ${base.failed} without`] : [])];
    const fixed = [...without.failures.filter(line => !withIt.failures.includes(line)), ...(own.ok > base.ok ? [`operator: ${own.ok} ok with the recipe, ${base.ok} without`] : [])];
    rows.push({case: item.name, broke, fixed, operator: {with: own, without: base}, exercised: own.ok + own.failed + base.ok + base.failed > 0});
  }
  // The operator must have run on the control in at least one form (the form reader may set it first): else the form says nothing about the recipe.
  if (rows.some(row => row.broke.length)) return {verdict: 'refused', rows};
  return {verdict: rows.some(row => row.exercised) ? 'pass' : 'not-exercised', rows};
}
