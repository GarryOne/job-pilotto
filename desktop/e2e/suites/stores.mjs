/* global document, window */
// The store setting (docs/superpowers/specs/2026-10-09-store-adapters.md): an app on the SQLite store tracks with no Notion at all, and one with no
// store chosen behaves as before (D7: "trying" still asks to connect). No Notion page and no token: `notion = false`. The steps that need the
// engine's callers on the store (a saved job in the Jobs list, an interview) and "Move my data to Notion" come as those pieces land.
import fs from 'node:fs';
import path from 'node:path';

export const name = 'stores';
export const notion = false;
export const keepGoing = true;
export const minutes = 6;

const KEY = 'sk-ant-api03-e2e-stores-not-a-real-key-0000000000000000000000000000000000000000000000000000';

export async function run(ctx) {
  const {page} = ctx;
  // Interviews is a view that asks for Notion in "trying" (Focus shows "Get started" there since 396d94e).
  const goInterviews = async () => { await page.click('.nav[data-view="interviews"]'); await page.waitForSelector('.view[data-view="interviews"]:not([hidden])'); };
  const gateShown = () => page.evaluate(() => !!document.querySelector('.view[data-view="interviews"] .notion-gate-host')?.children.length);
  const settle = async () => { await page.reload(); await page.waitForSelector('.view:not([hidden])', {timeout: 60000}); };

  await ctx.run('the app is set up on the SQLite store, with no Notion token', async () => {
    await page.evaluate(async key => {
      await window.pilot.saveSecret('ANTHROPIC_API_KEY', key);
      await window.pilot.saveSettings({setupDone: true, wizardStep: 'extras', setupFurthest: 'extras', store: 'sqlite'});
    }, KEY);
    await settle();
    const settings = JSON.parse(fs.readFileSync(path.join(ctx.profile, 'settings.json'), 'utf8'));
    if (settings.store !== 'sqlite') throw new Error(`the setting did not stick: store=${JSON.stringify(settings.store)}`);   // the positive control
  }, {critical: true});

  await ctx.run('Interviews opens without asking to connect Notion', async () => {
    await goInterviews();
    if (await gateShown()) throw new Error('Interviews shows the Notion gate on the SQLite store');
  });

  await ctx.run('a remembered answer is kept in this Mac\'s answers.md', async () => {
    const result = await page.evaluate(() => window.pilot.rememberAnswer('What is your notice period?', 'Three months, negotiable'));
    if (result?.needsNotion) throw new Error(`the app asked for Notion: ${result.text}`);
    if (result && result.ok === false) throw new Error(`rememberAnswer failed: ${result.text || JSON.stringify(result)}`);
    const file = path.join(ctx.profile, 'answers.md');
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (!text.includes('Three months, negotiable')) throw new Error(`answers.md does not hold the answer (${text.length} characters)`);
  });

  await ctx.run('with no store chosen and no Notion, Interviews still asks to connect (no change for anyone)', async () => {
    await page.evaluate(() => window.pilot.saveSettings({store: null}));
    await settle();
    await goInterviews();
    await page.waitForFunction(() => !!document.querySelector('.view[data-view="interviews"] .notion-gate-host')?.children.length, null, {timeout: 15000})
      .catch(() => { throw new Error('without a store chosen, Interviews no longer shows the Notion gate'); });
  });
}
