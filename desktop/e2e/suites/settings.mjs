/* global document, window */
// Settings: every section, with each AI engine chosen. Starts from a set-up install (a key saved, a workspace connected).
import {finish, snap} from '../lib/layout.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {FIXTURES} from '../lib/cvfixtures.mjs';
import {ensureSetUp} from '../lib/seed.mjs';

export const name = 'settings';
const SECTIONS = ['overview', 'profile', 'automation', 'connections', 'data', 'appearance', 'license', 'advanced'];

export async function run(ctx) {
  const {page, app} = ctx;
  ctx.findings = [];
  await ensureSetUp(ctx);
  await ctx.run('every Settings section renders', async () => {
    await page.click('.nav[data-view="settings"]:not([data-settings="profile"])');
    for (const section of SECTIONS) {
      await page.click(`[data-settings-go="${section}"]`);
      await snap(ctx, `settings-${section}`, {view: 'settings'});
    }
  }, {needs: ctx.needs});
  await ctx.run('the AI engine panel is coherent with each engine chosen (a key is saved in both)', async () => {
    await page.click('[data-settings-go="connections"]');
    // The engine panel opens from its service row's Manage button ("AI (Claude)"), as it does for a person.
    await page.locator('#conn-on .service-card, #conn-off .service-card').filter({hasText: 'AI (Claude)'}).first().getByRole('button').click();
    await page.locator('#ai-engine-settings [data-choice="cli"]').waitFor({state: 'visible', timeout: 15000});
    // Choosing Claude Code asks first ("Use your own Claude Code CLI?"); the engine only switches on the confirm. Then back to the API key, which switches at once.
    await page.locator('#ai-engine-settings [data-choice="cli"]').click();
    await page.getByRole('button', {name: 'Use Claude Code CLI'}).click();
    await page.waitForFunction(() => document.querySelector('#ai-engine-settings [data-choice="cli"]')?.getAttribute('aria-checked') === 'true', null, {timeout: 15000});
    await page.waitForTimeout(800);
    await snap(ctx, 'settings-engine-cli-chosen', {view: 'settings', situation: 'Claude Code CLI is the chosen engine, and an Anthropic API key is saved'});
    await page.locator('#ai-engine-settings [data-choice="api"]').click();
    await page.waitForFunction(() => document.querySelector('#ai-engine-settings [data-choice="api"]')?.getAttribute('aria-checked') === 'true', null, {timeout: 15000});
    await page.waitForTimeout(800);
    await snap(ctx, 'settings-engine-api-chosen', {view: 'settings', situation: 'The Anthropic API key is the chosen engine'});
  }, {needs: ctx.needs});
  await ctx.run('the CV check reads real PDFs: a plain CV passes, each known problem is found, a picture of a CV fails', async () => {
    const target = path.join(ctx.profile, 'cv.pdf'), original = fs.existsSync(target) ? fs.readFileSync(target) : null;
    try {
      for (const [name, fixture] of Object.entries(FIXTURES)) {
        // Printed by the app's own Chromium, then read by the app's own PDF reader (the same path a person's CV takes).
        const pdf = await app.evaluate(async ({BrowserWindow}, html) => {
          const win = new BrowserWindow({show: false, width: 794, height: 1123});
          await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
          const data = await win.webContents.printToPDF({pageSize: 'A4', printBackground: true, preferCSSPageSize: true});
          win.destroy();
          return data.toString('base64');
        }, fixture.html);
        fs.writeFileSync(target, Buffer.from(pdf, 'base64'));
        const result = await page.evaluate(() => window.pilot.cvCheckRun());
        if (!result.ok) throw new Error(`${name}: the CV check did not run: ${result.error}`);
        const byId = Object.fromEntries(result.ats.checks.map(item => [item.id, item.status]));
        const wrong = [...fixture.pass.filter(id => byId[id] !== 'pass').map(id => `${id} should pass but is ${byId[id]}`), ...fixture.fail.filter(id => byId[id] === 'pass').map(id => `${id} should be flagged`)];
        if (wrong.length) throw new Error(`${name} (score ${result.ats.score}): ${wrong.join('; ')}`);
        console.log(`  ${name}: score ${result.ats.score}, flagged ${result.ats.checks.filter(item => item.status !== 'pass').map(item => item.id).join(', ') || 'nothing'}`);
      }
    } finally { if (original) fs.writeFileSync(target, original); }
  }, {needs: ctx.needs});
  await ctx.run('Settings render without layout problems', async () => { finish(ctx); }, {needs: ctx.needs});
}
