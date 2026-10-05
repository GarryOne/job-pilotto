/* global window */
// Puts a freshly launched app into the "set up" state the way the wizard leaves it, without the wizard: the app's own calls for the key, the Notion connection
// (which finds the workspace already built in this suite's page) and "setup done". About ten seconds. A suite whose page is empty bootstraps with the real wizard path instead.
import fs from 'node:fs';
import path from 'node:path';
import {DUMMY_KEY} from './engine.mjs';
import {runWizard} from './wizard.mjs';

export async function fastSeed(ctx) {
  const {page} = ctx;
  // The Claude Code engine (a Mac): a placeholder key is saved (a key is "saved" in every install), Claude Code is verified and chosen the way the engine panel does it.
  await page.evaluate(async ({key, token, cli}) => {
    const keyed = await window.pilot.saveSecret('ANTHROPIC_API_KEY', key);
    if (keyed?.ok === false) throw new Error(`the key was refused: ${keyed.error}`);
    const connected = await window.pilot.notionConnect(token);
    if (!connected?.ok) throw new Error(`Notion did not connect: ${connected?.error || 'unknown'}`);
    if (cli) {
      const status = await window.pilot.verifyClaudeCode();
      if (!status?.authenticated) throw new Error(`Claude Code is not ready on this Mac (${status?.error || 'not signed in'}): sign in with claude, or E2E_AI_ENGINE=api with E2E_ANTHROPIC_KEY`);
      await window.pilot.setAiEngine('cli');
    }
    await window.pilot.saveSettings({setupDone: true, wizardStep: 'extras', setupFurthest: 'extras', ...(cli ? {} : {aiEngine: 'api'}), cvName: 'cv.pdf'});
  }, {key: ctx.engine === 'cli' ? DUMMY_KEY : ctx.key, token: ctx.token, cli: ctx.engine === 'cli'});
  fs.copyFileSync(ctx.cv, path.join(ctx.profile, 'cv.pdf'));   // forms and tailoring read the CV from the data folder
  await page.reload();
  await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
}

// The workspace exists in this suite's page: seed in seconds. Otherwise build it once with the real wizard path (and keep it for the next run).
export async function ensureSetUp(ctx) {
  if (ctx.built) {
    await ctx.run('the app is seeded as a set-up install from the existing workspace', () => fastSeed(ctx), {needs: ctx.needs, critical: true});   // every later step needs a set-up app
  } else {
    console.log(`The ${ctx.suite} suite's Notion page has no workspace yet: building it once with the real wizard path.`);
    await runWizard(ctx);
  }
}

// What the engine learned from the last searches (src/coverage.py): the postings it saw in the user's places and the role words their titles used that the keywords miss. With it the
// Strategy page shows "Your search may be too narrow" (a card the tests never saw before 5 Oct 2026, when it arrived late and pushed the page down). The numbers are the owner's real case.
export function seedCoverage(ctx, {now = new Date()} = {}) {
  const term = (word, count) => ({term: word, count, local: false, examples: [`Senior ${word} Engineer`]});
  fs.mkdirSync(path.join(ctx.profile, 'data'), {recursive: true});
  fs.writeFileSync(path.join(ctx.profile, 'data', 'coverage.json'), JSON.stringify({at: now.toISOString(), roles: ['sre'], regions: ['ch'], fetched: 9400, feeds: 14, in_places: 7582, matched: 434, title_hits: 640, elsewhere: 210,
    suggestions: [term('software engineer', 740), term('backend', 191), term('security engineer', 85), term('machine learning', 77)], places: []}));
}
