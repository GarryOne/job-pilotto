// The first-run path only: key, CV, strategy, finish WITHOUT Notion (the app only tries), then Notion connected and the strategy moved in. Starts from an emptied Notion page.
import {finish, visit} from '../lib/layout.mjs';
import {runWizard} from '../lib/wizard.mjs';

export const minutes = 20;
export const name = 'wizard';
export const fresh = true;
export const engine = 'api';   // the first-run path checks the API key itself
export async function run(ctx) {
  ctx.findings = [];
  await runWizard(ctx);
  await ctx.run('the first screens after setup render without layout problems', async () => {
    await visit(ctx, ['focus', 'jobs']);
    finish(ctx);
  }, {needs: ctx.needs});
}
