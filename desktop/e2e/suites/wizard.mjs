// The first-run path only: key, CV, strategy, finish WITHOUT Notion (the app only tries), then Notion connected and the strategy moved in. Starts from an emptied Notion page.
import {finish, visit} from '../lib/layout.mjs';
import {runWizard} from '../lib/wizard.mjs';

export const minutes = 20;
export const macos = true;   // runs on a macOS runner: the first run: the Keychain holds the keys it saves (lib/plan.mjs runnerOf)
export const name = 'wizard';
// The "Notion later" journey (set up without Notion, trying, then connect): a state that ends once a store is chosen, so it runs on Notion, the stand-in (P7).
export const store = 'standin';
export const fresh = true;
export async function run(ctx) {
  ctx.findings = [];
  await runWizard(ctx);
  await ctx.run('the first screens after setup render without layout problems', async () => {
    await visit(ctx, ['focus', 'jobs']);
    finish(ctx);
  }, {needs: ctx.needs});
}
