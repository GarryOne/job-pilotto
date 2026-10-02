// Settings: every section, with each AI engine chosen. Starts from a set-up install (a key saved, a workspace connected).
import {finish, snap} from '../lib/layout.mjs';
import {ensureSetUp} from '../lib/seed.mjs';

export const name = 'settings';
const SECTIONS = ['overview', 'profile', 'automation', 'connections', 'data', 'appearance', 'license', 'advanced'];

export async function run(ctx) {
  const {page} = ctx;
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
    for (const engine of ['cli', 'api']) {
      await page.locator(`#ai-engine-settings [data-choice="${engine}"]`).click();
      await page.waitForTimeout(800);
      await snap(ctx, `settings-engine-${engine}-chosen`, {view: 'settings', situation: `AI engine "${engine}" chosen, and an Anthropic API key is saved`});
    }
  }, {needs: ctx.needs});
  await ctx.run('Settings render without layout problems', async () => { finish(ctx); }, {needs: ctx.needs});
}
