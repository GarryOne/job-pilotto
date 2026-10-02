/* global document, window */
// The first-run path only: key, Notion workspace, CV, strategy, finish. Starts from an emptied Notion page.
import {finish, visit} from '../lib/layout.mjs';
import {runWizard} from '../lib/wizard.mjs';

export const name = 'wizard';
export const fresh = true;
export async function run(ctx) {
  ctx.findings = [];
  await runWizard(ctx);
  await ctx.run('the first screens after setup render without layout problems', async () => {
    await visit(ctx, ['focus', 'jobs']);
    finish(ctx);
  }, {needs: ctx.needs});
}
