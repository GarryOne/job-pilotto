/* global window */
// Puts a freshly launched app into the "set up" state the way the wizard leaves it, without the wizard: the app's own calls for the key, the Notion connection
// (which finds the workspace already built in this suite's page) and "setup done". About ten seconds. A suite whose page is empty bootstraps with the real wizard path instead.
import fs from 'node:fs';
import path from 'node:path';
import {runWizard} from './wizard.mjs';

export async function fastSeed(ctx) {
  const {page} = ctx;
  await page.evaluate(async ({key, token}) => {
    const keyed = await window.pilot.saveSecret('ANTHROPIC_API_KEY', key);
    if (keyed?.ok === false) throw new Error(`the key was refused: ${keyed.error}`);
    const connected = await window.pilot.notionConnect(token);
    if (!connected?.ok) throw new Error(`Notion did not connect: ${connected?.error || 'unknown'}`);
    await window.pilot.saveSettings({setupDone: true, wizardStep: 'extras', setupFurthest: 'extras', aiEngine: 'api', cvName: 'cv.pdf'});
  }, {key: ctx.key, token: ctx.token});
  fs.copyFileSync(ctx.cv, path.join(ctx.profile, 'cv.pdf'));   // forms and tailoring read the CV from the data folder
  await page.reload();
  await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
}

// The workspace exists in this suite's page: seed in seconds. Otherwise build it once with the real wizard path (and keep it for the next run).
export async function ensureSetUp(ctx) {
  if (ctx.built) {
    await ctx.run('the app is seeded as a set-up install from the existing workspace', () => fastSeed(ctx), {needs: ctx.needs});
  } else {
    console.log(`The ${ctx.suite} suite's Notion page has no workspace yet: building it once with the real wizard path.`);
    await runWizard(ctx);
  }
}
