/* global document */
// The end-to-end journey: a new user installs Job Pilotto and goes through the setup wizard (AI, Notion, CV, strategy),
// then runs a jobs check and looks at the scores. Each step prints how long it took; the first failure stops the run,
// leaves a screenshot in e2e/artifacts and exits non-zero.
//   node journey.mjs            # needs E2E_ANTHROPIC_KEY and E2E_NOTION_TOKEN for the steps that use them; others are skipped
// Read README.md for the secrets, the cost and what is faked.
import path from 'node:path';
import {E2E, launch, pickFile, step} from './lib/app.mjs';

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
const expectStep = async (page, name) => {
  await page.waitForFunction(wanted => [...document.querySelectorAll('.step')].find(el => !el.hidden && el.offsetParent !== null)?.dataset.step === wanted, name, {timeout: 20000})
    .catch(async () => { throw new Error(`expected the "${name}" step, the app shows "${await step(page)}"`); });
};

try {
  session = await launch();
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
} finally {
  await session?.shot('last');
  await session?.close();
  const failed = results.filter(result => result.status === 'failed').length;
  console.log(`\n${results.filter(r => r.status === 'passed').length} passed, ${failed} failed, ${results.filter(r => r.status === 'skipped').length} skipped`);
  // The app and Playwright can leave handles open (the app keeps helper processes running): exit explicitly, never hang a CI job.
  process.exit(failed ? 1 : 0);
}
