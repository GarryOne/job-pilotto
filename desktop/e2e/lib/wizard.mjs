/* global document, window, getComputedStyle */
// The real first-run path, step by step: the setup wizard with a key, a Notion workspace, a CV and a strategy built by the AI. The wizard suite runs it on an
// emptied page; any other suite runs it once to build its own Notion workspace when its page has none yet, and then keeps the workspace.
import {step} from './app.mjs';

export async function runWizard(ctx) {
  const {page, key: KEY, token: NOTION} = ctx;
  await ctx.run('the app starts on the welcome screen', async () => {
    await ctx.expectStep('welcome');
    await page.getByRole('button', {name: 'Start'}).waitFor();
  });
  await ctx.run('Start opens the AI step with both engines to choose from', async () => {
    await page.locator('.step[data-step="welcome"] [data-next]').click();
    await ctx.expectStep('ai');
    await page.locator('[data-choice="api"]').waitFor();
    await page.locator('[data-choice="cli"]').waitFor();
  });
  await ctx.run('the AI step will not continue without a key', async () => {
    await page.locator('[data-choice="api"]').click();
    await page.locator('#anthropic-key').waitFor();
    if (!(await page.locator('#ai-save').isDisabled())) throw new Error('"Check and save" is enabled with no key typed');
  });
  await ctx.run('a valid API key is accepted and saved', async () => {
    await page.fill('#anthropic-key', KEY);
    await page.click('#ai-save');
    await ctx.expectStep('notion');
  }, {needs: [{name: 'E2E_ANTHROPIC_KEY', value: KEY}]});
  await ctx.run('a Notion token connects and the workspace is built inside the test page', async () => {
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
  }, {needs: ctx.needs});
  await ctx.run('a CV is chosen and read', async () => {
    await ctx.pickCv();
    await page.click('#cv-choose');
    await page.waitForFunction(() => document.getElementById('cv-name')?.textContent !== 'No CV chosen yet', null, {timeout: 30000});
    await page.waitForFunction(() => !document.getElementById('cv-next')?.disabled, null, {timeout: 30000});
    await page.click('#cv-next');
    await ctx.expectStep('draft');
  }, {needs: ctx.needs});
  await ctx.run('the strategy is built from the CV and shows roles to search for', async () => {
    await page.click('#draft-build');
    await page.locator('#draft-view').waitFor({state: 'visible', timeout: 300000});
    const roles = await page.locator('#chips-roles > *').count();
    if (!roles) throw new Error('the strategy has no roles to search for');
    await page.click('#draft-save');
    await ctx.expectStep('extras', 180000);
  }, {needs: ctx.needs});
  await ctx.run('finishing the setup opens the main window', async () => {
    await page.click('#finish');
    await page.waitForFunction(() => !!document.querySelector('.view:not([hidden])'), null, {timeout: 60000});
    const view = await page.evaluate(() => document.querySelector('.view:not([hidden])')?.dataset.view);
    if (!['focus', 'jobs'].includes(view)) throw new Error(`after the setup the app shows "${view}"`);
  }, {needs: ctx.needs});
}
