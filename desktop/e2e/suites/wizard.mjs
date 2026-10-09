// The first-run path of a new install: key, CV, strategy, finish without Notion on this Mac's store (given at first start), then, on the stand-in, Notion
// connected while that store is still empty: the store becomes Notion and the strategy moves in ("Start using Notion"). Starts from an emptied Notion page.
import {finish, visit} from '../lib/layout.mjs';
import {runWizard} from '../lib/wizard.mjs';

export const minutes = 20;
export const macos = true;   // runs on a macOS runner: the first run: the Keychain holds the keys it saves (lib/plan.mjs runnerOf)
export const name = 'wizard';
// The first run on either store (P7), started with no store at all as a new install is (newInstall): the app gives it this Mac; on the stand-in the run then
// connects Notion with nothing stored yet (lib/wizard.mjs). A store with data stays at connect: suites/storemove.mjs.
export const fresh = true;
export const newInstall = true;
export async function run(ctx) {
  ctx.findings = [];
  await runWizard(ctx);
  await ctx.run('the first screens after setup render without layout problems', async () => {
    await visit(ctx, ['focus', 'jobs']);
    finish(ctx);
  }, {needs: ctx.needs});
}
