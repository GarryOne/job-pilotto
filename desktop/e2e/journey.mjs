/* global document, window */
// The end-to-end journey: a new user installs Job Pilotto and goes through the setup wizard (AI, Notion, CV, strategy),
// then runs a jobs check and looks at the scores. Each step prints how long it took; the first failure stops the run,
// leaves a screenshot in e2e/artifacts and exits non-zero.
//   node journey.mjs            # needs E2E_ANTHROPIC_KEY and E2E_NOTION_TOKEN for the steps that use them; others are skipped
// Read README.md for the secrets, the cost and what is faked.
import fs from 'node:fs';
import path from 'node:path';
import {ARTIFACTS, E2E, assertNothingQueued, launch, pickFile, settle, step} from './lib/app.mjs';
import {clearRoot, findPage, testRoot} from './lib/notion.mjs';
import {LIMITS, VIEWS, inspect} from './lib/uicheck.mjs';

const KEY = process.env.E2E_ANTHROPIC_KEY || '', NOTION = process.env.E2E_NOTION_TOKEN || '';
// A local run may point E2E_CV at a real CV on this Mac (never copied into the repo, which is public); CI uses the fictional one.
const CV = process.env.E2E_CV || path.join(E2E, 'fixtures', 'cv.pdf');
const results = [];
let session;

async function run(name, fn, {needs = []} = {}) {
  const missing = needs.filter(item => !item.value);
  if (missing.length) { results.push({name, status: 'skipped', note: `needs ${missing.map(item => item.name).join(', ')}`}); console.log(`- ${name}: skipped (needs ${missing.map(item => item.name).join(', ')})`); return; }
  const started = Date.now();
  try {
    await fn(session.page, session);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    results.push({name, status: 'passed', seconds});
    console.log(`✓ ${name} (${seconds}s)`);
  } catch (error) {
    await session.shot(`failed-${name.replace(/\W+/g, '-')}`);
    results.push({name, status: 'failed', note: error.message});
    console.log(`✗ ${name}: ${error.message}`);
    throw error;
  }
}
const expectStep = async (page, name, timeout = 20000) => {
  await page.waitForFunction(wanted => [...document.querySelectorAll('.step')].find(el => !el.hidden && el.offsetParent !== null)?.dataset.step === wanted, name, {timeout})
    .catch(async () => { throw new Error(`expected the "${name}" step, the app shows "${await step(page)}"`); });
};

try {
  // A new user starts with an empty Notion page: empty the test page first (to the trash; refuses any other workspace).
  const root = NOTION ? await testRoot(NOTION) : null;
  if (root) console.log(`Notion test page "${root.title}" in "${root.workspace}": ${await clearRoot(NOTION, root.id)} item(s) moved to the trash`);
  // Every AI step on the cheapest model: the journey checks that things work, not how good the answers are.
  session = await launch({env: {JOB_PILOTTO_MODEL_OVERRIDE: 'claude-haiku-4-5', JOB_PILOTTO_FIXTURE_DIR: path.join(E2E, 'fixtures', 'feeds')}});
  const {page} = session;

  await run('the app starts on the welcome screen', async () => {
    await expectStep(page, 'welcome');
    await page.getByRole('button', {name: 'Start'}).waitFor();
  });
  await run('Start opens the AI step with both engines to choose from', async () => {
    await page.locator('.step[data-step="welcome"] [data-next]').click();
    await expectStep(page, 'ai');
    await page.locator('[data-choice="api"]').waitFor();
    await page.locator('[data-choice="cli"]').waitFor();
  });
  await run('the AI step will not continue without a key', async () => {
    await page.locator('[data-choice="api"]').click();
    await page.locator('#anthropic-key').waitFor();
    if (!(await page.locator('#ai-save').isDisabled())) throw new Error('"Check and save" is enabled with no key typed');
  });
  await run('a valid API key is accepted and saved', async () => {
    await page.fill('#anthropic-key', KEY);
    await page.click('#ai-save');
    await expectStep(page, 'notion');
  }, {needs: [{name: 'E2E_ANTHROPIC_KEY', value: KEY}]});
  await run('a Notion token connects and the workspace is built inside the test page', async () => {
    await page.evaluate(() => { const box = document.getElementById('notion-manual'); box.hidden = false; box.open = true; });
    await page.fill('#notion-key', NOTION);
    await page.click('#notion-connect');
    // The app builds the workspace, then moves on by itself (or offers Continue, if it was already built).
    const started = Date.now();
    while ((await step(page)) !== 'cv') {
      if (Date.now() - started > 240000) throw new Error(`the workspace was not built in 4 minutes (the app shows "${await step(page)}": ${await page.locator('#notion-message').innerText().catch(() => '')})`);
      if (await page.locator('#notion-next').isVisible().catch(() => false)) await page.click('#notion-next');
      await page.waitForTimeout(1000);
    }
  }, {needs: [{name: 'E2E_NOTION_TOKEN', value: NOTION}, {name: 'E2E_ANTHROPIC_KEY', value: KEY}]});
  await run('a CV is chosen and read', async (_page, {app}) => {
    await pickFile(app, CV);
    await page.click('#cv-choose');
    await page.waitForFunction(() => document.getElementById('cv-name')?.textContent !== 'No CV chosen yet', null, {timeout: 30000});
    await page.waitForFunction(() => !document.getElementById('cv-next')?.disabled, null, {timeout: 30000});
    await page.click('#cv-next');
    await expectStep(page, 'draft');
  }, {needs: [{name: 'E2E_NOTION_TOKEN', value: NOTION}, {name: 'E2E_ANTHROPIC_KEY', value: KEY}]});
  await run('the strategy is built from the CV and shows roles to search for', async () => {
    await page.click('#draft-build');
    await page.locator('#draft-view').waitFor({state: 'visible', timeout: 300000});
    const roles = await page.locator('#chips-roles > *').count();
    if (!roles) throw new Error('the strategy has no roles to search for');
    await page.click('#draft-save');
    await expectStep(page, 'extras', 180000);
  }, {needs: [{name: 'E2E_NOTION_TOKEN', value: NOTION}, {name: 'E2E_ANTHROPIC_KEY', value: KEY}]});
  await run('finishing the setup opens the main window', async () => {
    await page.click('#finish');
    await page.waitForFunction(() => !!document.querySelector('.view:not([hidden])'), null, {timeout: 60000});
    const view = await page.evaluate(() => document.querySelector('.view:not([hidden])')?.dataset.view);
    if (!['focus', 'jobs'].includes(view)) throw new Error(`after the setup the app shows "${view}"`);
  }, {needs: [{name: 'E2E_NOTION_TOKEN', value: NOTION}, {name: 'E2E_ANTHROPIC_KEY', value: KEY}]});
  await run('a jobs check reads the fixture feeds, drops the wrong roles and scores the matching jobs', async () => {
    // The employers to crawl: two fixture boards (feeds come from fixtures/feeds, never the network).
    fs.mkdirSync(path.join(session.profile, 'config'), {recursive: true});
    fs.copyFileSync(path.join(E2E, 'fixtures', 'feeds', 'sources.json'), path.join(session.profile, 'config', 'sources.json'));
    await page.click('.nav[data-view="jobs"]');
    await page.click('#refresh');
    const scored = () => page.evaluate(() => (window.__jp.shared.allJobs || []).filter(job => job.title && job.fit != null && job.fit !== '').map(job => ({title: job.title, fit: Number(job.fit)})));
    await page.waitForFunction(() => (window.__jp.shared.allJobs || []).some(job => /reliability|devops|platform/i.test(job.title) && job.fit != null && job.fit !== ''),
      null, {timeout: 480000, polling: 3000});
    const jobs = await scored();
    const titles = jobs.map(job => job.title);
    console.log(`  scored: ${jobs.map(job => `${job.title} (${job.fit})`).join('; ')}`);
    if (jobs.some(job => !(job.fit >= 0 && job.fit <= 100))) throw new Error('a score is outside 0 to 100');
    const wrong = titles.filter(title => /account executive|product designer|intern/i.test(title));
    if (wrong.length) throw new Error(`jobs for the wrong role were kept: ${wrong.join(', ')}`);
  }, {needs: [{name: 'E2E_NOTION_TOKEN', value: NOTION}, {name: 'E2E_ANTHROPIC_KEY', value: KEY}]});
  await run('Find new employers probes the seed company and lists it in Notion', async () => {
    fs.copyFileSync(path.join(E2E, 'fixtures', 'feeds', 'scout_seeds.json'), path.join(session.profile, 'config', 'scout_seeds.json'));
    await page.click('.nav[data-view="actions"]');
    await page.click('[data-command="scout"]');
    const started = Date.now();
    let listed = null;
    while (!listed && Date.now() - started < 240000) {
      listed = await findPage(NOTION, 'E2E Gamma').catch(() => null);
      if (!listed) await page.waitForTimeout(4000);
    }
    if (!listed) throw new Error('"E2E Gamma" was not listed in Notion (Employers & Sources) within 4 minutes');
  }, {needs: [{name: 'E2E_NOTION_TOKEN', value: NOTION}, {name: 'E2E_ANTHROPIC_KEY', value: KEY}]});
  await run('every page renders without layout problems', async () => {
    const findings = [];
    for (const view of VIEWS) {
      await page.click(`.nav[data-view="${view}"]`);
      const settled = await settle(page);
      if (!settled) findings.push({view, severity: 'warning', kind: 'stuck-loading', detail: 'the page still shows its loading state (skeleton or spinner) after 20 seconds'});
      await session.shot(`ui-${view}`);
      findings.push(...await page.evaluate(inspect, {view, limits: LIMITS}));
    }
    fs.writeFileSync(path.join(ARTIFACTS, 'ui-findings.json'), JSON.stringify(findings, null, 2));
    for (const finding of findings) console.log(`  ${finding.severity === 'severe' ? '✗' : '!'} [${finding.view}] ${finding.kind}: ${finding.detail}`);
    const severe = findings.filter(finding => finding.severity === 'severe');
    if (severe.length) throw new Error(`${severe.length} severe layout problem(s): ${severe.map(f => `${f.view}/${f.kind}`).join(', ')}`);
  }, {needs: [{name: 'E2E_NOTION_TOKEN', value: NOTION}, {name: 'E2E_ANTHROPIC_KEY', value: KEY}]});
  await run('nothing was queued to report to the product', async () => { assertNothingQueued(session.profile); });
} finally {
  await session?.shot('last');
  await session?.close();
  const failed = results.filter(result => result.status === 'failed').length;
  console.log(`\n${results.filter(r => r.status === 'passed').length} passed, ${failed} failed, ${results.filter(r => r.status === 'skipped').length} skipped`);
  // The app and Playwright can leave handles open (the app keeps helper processes running): exit explicitly, never hang a CI job.
  process.exit(failed ? 1 : 0);
}
