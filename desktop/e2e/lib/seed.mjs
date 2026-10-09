/* global window */
// Puts a freshly launched app into the "set up" state the way the wizard leaves it, without the wizard: the app's own calls for the key, the Notion connection
// (which finds the workspace already built in this suite's page) and "setup done". About ten seconds. A suite whose page is empty bootstraps with the real wizard path instead.
import fs from 'node:fs';
import path from 'node:path';
import {appKey, DUMMY_KEY} from './engine.mjs';
import {runWizard} from './wizard.mjs';
import {E2E} from './app.mjs';

export async function fastSeed(ctx) {
  const {page} = ctx;
  // The engine under test (lib/engine.mjs: the family alternates on CI). A placeholder Anthropic key is always saved (a key is "saved" in every install, and ctx.withApi needs
  // one); an OpenAI engine also gets its key. A CLI (Claude Code, Codex) is verified and chosen the way the engine panel does it.
  // The stand-in is built empty of a strategy (lib/notion-fake.mjs buildStandIn): the first app of the run saves the e2e applicant's (an SRE in Zurich, the fixture
  // CV and feeds), from desktop/demo/draft.json, kept in the draft's current shape by the demo. 9 Oct 2026: without it searches ran on the app's default roles.
  const strategy = ctx.standIn && ctx.store === 'standin' && !ctx.standIn.strategySaved ? JSON.parse(fs.readFileSync(path.join(E2E, '..', 'demo', 'draft.json'), 'utf8')).draft : null;
  if (strategy) ctx.standIn.strategySaved = true;
  await page.evaluate(async ({anthropic, openai, token, engine, strategy}) => {
    const keyed = await window.pilot.saveSecret('ANTHROPIC_API_KEY', anthropic);
    if (keyed?.ok === false) throw new Error(`the key was refused: ${keyed.error}`);
    if (openai) await window.pilot.saveSecret('OPENAI_API_KEY', openai);
    const connected = await window.pilot.notionConnect(token);
    if (!connected?.ok) throw new Error(`Notion did not connect: ${connected?.error || `missing ${JSON.stringify(connected?.missing || [])}, problems ${JSON.stringify((connected?.problems || []).map(p => p.title || p))}, found ${JSON.stringify(Object.keys(connected?.ids || {}))}`}`);   // no error text: say what the connect found
    if (strategy) {   // a fresh stand-in: the applicant's strategy, saved the way the wizard's Save does (the real test page holds one from its first run)
      const saved = await window.pilot.saveStrategy(strategy);
      if (!saved?.ok) throw new Error(`the strategy was not saved: ${saved?.error || 'unknown'}`);
    }
    if (engine === 'cli' || engine === 'codex') {
      const status = await (engine === 'cli' ? window.pilot.verifyClaudeCode() : window.pilot.verifyCodex());
      if (!status?.authenticated) throw new Error(`${engine === 'cli' ? 'Claude Code' : 'Codex'} is not ready on this Mac (${status?.error || 'not signed in'}): sign in with ${engine === 'cli' ? 'claude' : 'codex login'}`);
    }
    await window.pilot.setAiEngine(engine);
    await window.pilot.saveSettings({setupDone: true, wizardStep: 'extras', setupFurthest: 'extras', cvName: 'cv.pdf'});
  }, {anthropic: ctx.engine === 'api' ? appKey(ctx.key) : DUMMY_KEY, openai: ctx.engine === 'openai' ? ctx.key : '', token: ctx.token, engine: ctx.engine, strategy});
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
