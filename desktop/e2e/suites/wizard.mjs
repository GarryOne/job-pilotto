// The first-run path only: key, CV, strategy, finish WITHOUT Notion (the app only tries), then Notion connected and the strategy moved in. Starts from an emptied Notion page.
import {finish, visit} from '../lib/layout.mjs';
import {runWizard} from '../lib/wizard.mjs';

export const minutes = 20;
export const macos = true;   // runs on a macOS runner: the first run: the Keychain holds the keys it saves (lib/plan.mjs runnerOf)
export const name = 'wizard';
// The first run on either store (P7): on this Mac's store (what a new install gets) the setup ends with the data on this Mac and nothing asks for Notion;
// on the Notion store (the stand-in) it is the "Notion later" journey: set up without Notion, trying, then connect (lib/wizard.mjs).
export const fresh = true;
export async function run(ctx) {
  ctx.findings = [];
  await runWizard(ctx);
  await ctx.run('the first screens after setup render without layout problems', async () => {
    await visit(ctx, ['focus', 'jobs']);
    finish(ctx);
  }, {needs: ctx.needs});
}
