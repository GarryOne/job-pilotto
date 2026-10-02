#!/usr/bin/env node
// The form lab: a headless browser runs the extension's REAL operators (extension/page/skeleton.js and controls.js) on public
// application forms with a test applicant, and reports what worked to the site (POST /api/lab). It never submits: every POST
// request the page makes is blocked, and nothing but the operators' own clicks is done. It also tries the site's candidate recipes
// and, when one works on enough different pages, gives it a small canary. Design: Notion "Self-improving form filling".
//   node tools/form-lab.mjs --urls urls.txt [--max 25] [--site https://www.jobpilotto.workers.dev] [--key KEY | env LAB_KEY]
//                           [--promote] [--out result.json] [--dry]
// Needs playwright-core and a Chromium (the workflow installs them); CHROME_PATH points at a local one.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {applicationUrl, decidePromotion, runsFrom, siteOf, testAnswer} from './form-lab-lib.mjs';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = (name, fallback = '') => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const root = fileURLToPath(new URL('../extension/page/', import.meta.url));
const site = option('site', 'https://www.jobpilotto.workers.dev').replace(/\/$/, '');
const key = option('key', process.env.LAB_KEY || '');
const max = Number(option('max', '25')) || 25;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const skeleton = fs.readFileSync(`${root}skeleton.js`, 'utf8');
const controls = fs.readFileSync(`${root}controls.js`, 'utf8');
const owner = () => ({Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'});

const urls = fs.readFileSync(option('urls'), 'utf8').split('\n').map(line => applicationUrl(line.trim())).filter(Boolean).slice(0, max);
if (!urls.length) { console.log('No application URLs.'); process.exit(0); }

// Candidate recipes to try (the owner's key sees them).
let candidates = [];
if (flag('promote') && key) {
  const response = await fetch(`${site}/api/recipes?status=candidate`, {headers: owner()}).catch(() => null);
  candidates = response?.ok ? (await response.json()).recipes || [] : [];
}
const recipeMap = Object.fromEntries(candidates.map(recipe => [recipe.fingerprint, recipe]));

const {chromium} = await import('playwright-core');
const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || undefined});
const runs = [], samples = [], tries = new Map();
for (const url of urls) {
  const name = siteOf(url);
  const page = await browser.newPage({userAgent: 'JobPilottoFormLab/1.0 (+https://www.jobpilotto.workers.dev) public application forms, never submits'});
  // Nothing is ever submitted: a POST that looks like an application submission is stopped. Other POSTs stay allowed because
  // some boards (Ashby) load the form itself through one. The lab clicks nothing but the operators' own targets anyway.
  await page.route('**/*', route => {
    const request = route.request();
    return request.method() === 'POST' && /submit|apply|application/i.test(`${new URL(request.url()).pathname} ${(request.postData() || '').slice(0, 400)}`) && !/form|definition|info|config/i.test(request.postData()?.slice(0, 120) || '')
      ? route.abort() : route.continue();
  });
  try {
    await page.goto(url, {waitUntil: 'networkidle', timeout: 30000});
    await page.waitForTimeout(2000);
    await page.evaluate(skeleton);
    await page.evaluate(controls);
    // What controls are here, their questions and their choices, to build the test applicant's answers.
    const found = await page.evaluate(() => {
      const kit = window.__jobPilottoSkeleton, ops = window.__jobPilottoControls, shown = el => !!el.getClientRects().length;
      return kit.widgets(document, shown).map(({el, kind}) => ({kind, fp: kit.fingerprint(kit.skeleton(el)), question: ops.titleOf(el),
        options: kind === 'toggle-group' ? [...el.querySelectorAll('button, [role=radio]')].map(button => button.textContent.trim()) : [],
        skeleton: kit.skeleton(el)}));
    });
    const dates = await page.evaluate(() => [...document.querySelectorAll('input')].filter(input => (input.type === 'date' || /date/i.test(`${input.placeholder} ${input.className}`)) && input.getClientRects().length && !input.value)
      .map(input => ({question: window.__jobPilottoControls.titleOf(input), fp: window.__jobPilottoSkeleton.fingerprint(window.__jobPilottoSkeleton.skeleton(input))})));
    const answers = [...found.filter(item => item.kind === 'toggle-group' && item.question).map(item => ({question: item.question, value: testAnswer(item.kind, item.options)})),
      ...dates.filter(item => item.question).map(item => ({question: item.question, value: testAnswer('date')}))];
    const results = await page.evaluate(async ({answers, recipes}) => window.__jobPilottoControls.fill(answers, {recipes}), {answers, recipes: recipeMap});
    runs.push(...runsFrom(name, results));
    for (const result of results) if (recipeMap[result.fp] && result.recipe) { const list = tries.get(result.fp) || []; list.push({page: url, ok: result.ok}); tries.set(result.fp, list); }
    // Controls with no operator: counted as not handled, and their structure kept for proposing recipes.
    const operated = new Set(results.map(result => result.fp));
    for (const item of found) {
      if (!operated.has(item.fp) && item.kind !== 'toggle-group') runs.push({site: name, fingerprint: item.fp, kind: item.kind, recipe: 0, ok: false, why: 'no operator for this kind'});
      if (!operated.has(item.fp) || !item.options.length) samples.push({fingerprint: item.fp, kind: item.kind, skeleton: item.skeleton, question: item.question});
    }
    console.log(`${name}: ${found.length} controls, ${results.filter(r => r.ok).length}/${results.length} operated  ${url}`);
  } catch (error) {
    console.log(`${name}: skipped (${error.message.split('\n')[0]})  ${url}`);
  } finally { await page.close(); }
  await sleep(3000);   // gentle: one page every few seconds
}
await browser.close();

const decisions = [...tries].map(([fingerprint, list]) => ({fingerprint, ...decidePromotion(list)}));
const out = {runs, samples: samples.slice(0, 50), decisions};
if (option('out')) fs.writeFileSync(option('out'), JSON.stringify(out, null, 1));
console.log(`${runs.length} control runs, ${runs.filter(run => run.ok).length} worked; ${samples.length} structures; decisions: ${JSON.stringify(decisions)}`);
if (flag('dry') || !key) { console.log(key ? 'Dry run: nothing sent.' : 'No LAB_KEY: nothing sent.'); process.exit(0); }
const sent = await fetch(`${site}/api/lab`, {method: 'POST', headers: owner(), body: JSON.stringify({runs: runs.slice(0, 500), samples: out.samples})});
console.log(`Sent to the site: ${sent.status}`);
for (const decision of decisions.filter(item => item.promote)) {
  const response = await fetch(`${site}/api/recipes`, {method: 'PUT', headers: owner(), body: JSON.stringify({recipe: recipeMap[decision.fingerprint], status: 'canary', rollout: 5, source: 'lab',
    note: `lab: ${decision.ok} of ${decision.tries} worked on ${decision.pages} pages`})});
  console.log(`Canary for ${decision.fingerprint}: ${response.status}`);
}
