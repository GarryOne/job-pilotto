/* global document, window */
// The real first-run path, step by step (Notion later, 3 Oct 2026): the setup wizard with a key, a CV and a strategy built by the AI, finished WITHOUT Notion
// (the app only tries: the Jobs list opens, Focus asks to connect), then Notion connected with a token: the workspace is built and the strategy moves in.
// The wizard suite runs it on an emptied page; any other suite runs it once to build its own Notion workspace when its page has none yet, and then keeps the workspace.
import fs from 'node:fs';
import path from 'node:path';
import {pageText} from './notion.mjs';

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
    await ctx.expectStep('cv');
  }, {needs: [{name: 'E2E_ANTHROPIC_KEY', value: KEY}]});
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
  await ctx.run('finishing the setup without Notion opens the Jobs list, with the strategy kept on this Mac', async () => {
    await page.click('#finish');
    await page.waitForFunction(() => !!document.querySelector('.view:not([hidden])'), null, {timeout: 60000});
    const view = await page.evaluate(() => document.querySelector('.view:not([hidden])')?.dataset.view);
    if (view !== 'jobs') throw new Error(`after a setup without Notion the app shows "${view}", not the Jobs list`);
    const state = await page.evaluate(() => window.pilot.state());
    if (state.notion) throw new Error('the app says Notion is connected, but it was never connected');
    if (!state.hasProfile) throw new Error('the strategy was not kept on this Mac');
    if (!fs.existsSync(path.join(ctx.profile, 'profile.md'))) throw new Error('profile.md is not in the app folder');
  }, {needs: ctx.needs});
  await ctx.run('Focus asks to connect Notion, lists the advantages, and Not now with a reason closes the prompt', async () => {
    await page.click('.nav[data-view="focus"]');
    await page.locator('.view[data-view="focus"] .ui-gate').waitFor({timeout: 15000});
    await page.locator('.view[data-view="focus"] .ui-gate button.primary').click();
    await page.locator('#notion-connect-dialog[open]').waitFor({timeout: 5000});
    const benefits = await page.locator('#notion-connect-benefits li').count();
    if (benefits !== 6) throw new Error(`the prompt lists ${benefits} advantages, not 6`);
    const reason = await page.locator('#notion-connect-reason').innerText();
    if (!/Connect Notion to see what to do next\./.test(reason)) throw new Error(`the prompt's reason reads "${reason}"`);
    await page.click('#notion-connect-later');
    await page.locator('#notion-connect-why .ui-tag', {hasText: 'Privacy'}).click();
    await page.locator('#notion-connect-dialog[open]').waitFor({state: 'detached', timeout: 5000}).catch(async () => {
      if (await page.locator('#notion-connect-dialog').evaluate(dialog => dialog.open)) throw new Error('the prompt stayed open after Not now');
    });
  }, {needs: ctx.needs});
  await ctx.run('a Notion token connects: the workspace is built inside the test page and the strategy moves in', async () => {
    const result = await page.evaluate(token => window.pilot.notionConnect(token), NOTION);
    if (!result?.ok) throw new Error(`Notion did not connect: ${result?.error || (result?.problems || []).map(p => p.title).join(', ') || 'unknown'}`);
    const started = Date.now();
    let text = '';
    while (text.length < 200) {   // the Profile page holds the strategy's Profile once the move-in has run
      if (Date.now() - started > 240000) throw new Error('the strategy did not reach the Notion Profile page in 4 minutes');
      text = await pageText(NOTION, 'Profile — CV and Preferences');
      if (text.length < 200) await page.waitForTimeout(3000);
    }
    const state = await page.evaluate(() => window.pilot.state());
    if (!state.notion) throw new Error('the app does not know it is connected');
    if (fs.existsSync(path.join(ctx.profile, 'profile.md'))) throw new Error('profile.md is still on this Mac after it moved to Notion');
  }, {needs: ctx.needs});
}
