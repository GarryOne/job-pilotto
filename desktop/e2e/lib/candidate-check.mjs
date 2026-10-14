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
      for (const entry of Array.isArray(body.items) ? body.items : []) { const sums = operated[entry.fp] ||= {ok: 0, failed: 0}; if (entry.ok) sums.ok++; else { sums.failed++; sums.why = entry.why; } }
    }
    return {failures: result.failures, operated};
  } finally { await run.close(); }
}

// A fill of a real page is not exactly repeatable (a date-picker library settles late), so each side is filled RUNS times and judged by its best run: the recipe is worse only when even
// its best run is worse than the built-in's best (fewer operator successes, more failures), or when a check fails in every run with the recipe and in none without it.
const RUNS = 2;
const best = (runs, fp) => runs.map(run => run.operated[fp] || {ok: 0, failed: 0}).sort((a, b) => b.ok - a.ok || a.failed - b.failed)[0];
// -> {broke, fixed, operator: {with, without}, exercised} for one form from its runs {failures, operated} with and without the recipe. Pure: tested without a browser.
export function judgeRow(withRuns, withoutRuns, fingerprint) {
  const own = best(withRuns, fingerprint), base = best(withoutRuns, fingerprint);
  const everyWith = line => withRuns.every(run => run.failures.includes(line)), anyWithout = line => withoutRuns.some(run => run.failures.includes(line));
  const everyWithout = line => withoutRuns.every(run => run.failures.includes(line)), anyWith = line => withRuns.some(run => run.failures.includes(line));
  const lines = runs => [...new Set(runs.flatMap(run => run.failures))];
  const worse = own.failed > base.failed || own.ok < base.ok;
  return {
    broke: [...lines(withRuns).filter(line => everyWith(line) && !anyWithout(line)), ...(worse ? [`operator: ${own.ok} ok / ${own.failed} failed with the recipe, ${base.ok} / ${base.failed} without`] : [])],
    fixed: [...lines(withoutRuns).filter(line => everyWithout(line) && !anyWith(line)), ...(own.ok > base.ok ? [`operator: ${own.ok} ok with the recipe, ${base.ok} without`] : [])],
    operator: {with: own, without: base}, exercised: own.ok + own.failed + base.ok + base.failed > 0,
  };
}

// The verdict over every form's row: refused when any row broke something; the operator must have run on the control in at least one form (the form reader may set it first), else not-exercised.
export function verdictOf(rows) {
  if (rows.some(row => row.broke.length)) return 'refused';
  return rows.some(row => row.exercised) ? 'pass' : 'not-exercised';
}

// recipe -> {verdict: 'refused' | 'pass' | 'not-exercised' | 'no-recorded-form', rows: [{case, broke, fixed, operator, exercised}], why?}. `cases`, `fingerprints` and `fill` may be given (tests).
export async function checkCandidate(recipe, {cases = loadCases(), extensionDir, fingerprints, fill = fillOnce} = {}) {
  const checked = validateRecipe(recipe);
  if (!checked.ok) return {verdict: 'refused', rows: [], why: `not a valid recipe: ${checked.error || 'shape'}`};
  const prints = fingerprints || await fingerprintsOfCases(cases);
  const holding = cases.filter(item => (prints.get(item.name) || []).includes(checked.recipe.fingerprint));
  if (!holding.length) return {verdict: 'no-recorded-form', rows: []};
  const rows = [];
  for (const item of holding) {
    const runs = async recipes => { const done = []; for (let i = 0; i < RUNS; i++) done.push(await fill(item, recipes, {extensionDir})); return done; };
    const without = await runs({}), withIt = await runs({[checked.recipe.fingerprint]: checked.recipe});
    rows.push({case: item.name, ...judgeRow(withIt, without, checked.recipe.fingerprint)});
  }
  return {verdict: verdictOf(rows), rows};
}
