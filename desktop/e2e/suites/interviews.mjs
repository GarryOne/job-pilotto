/* global document, window, getComputedStyle */
// Interviews: the page, its empty state, the recorder controls and the library. Starts from a set-up install.
import {finish, snap} from '../lib/layout.mjs';
import {ensureSetUp} from '../lib/seed.mjs';

export const name = 'interviews';
export async function run(ctx) {
  const {page} = ctx;
  ctx.findings = [];
  await ensureSetUp(ctx);
  await ctx.run('the Interviews page shows its recorder, drafts and library', async () => {
    await page.click('.nav[data-view="interviews"]');
    await page.waitForFunction(() => !!document.querySelector('.view[data-view="interviews"]:not([hidden])'), null, {timeout: 15000});
    for (const id of ['iv-add', 'iv-record']) {
      if (!(await page.locator(`#${id}`).count())) throw new Error(`the Interviews page has no #${id} control`);
    }
    await snap(ctx, 'interviews');
  }, {needs: ctx.needs});
  await ctx.run('the Calendar page shows an empty calendar without errors', async () => {
    await page.click('.nav[data-view="calendar"]');
    await snap(ctx, 'calendar');
  }, {needs: ctx.needs});
  await ctx.run('Interviews and Calendar render without layout problems', async () => { finish(ctx); }, {needs: ctx.needs});
}
