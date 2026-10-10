// Layer 2 of the applying tests (owner, 10 Oct 2026): every recorded page case (e2e/recorded/*) replayed in headless Chromium with the real extension and the
// recorded AI answers, offline (lib/page-replay.mjs). One step per case, so a failure names the case. No app window, no Notion, no AI, no network: about a minute.
// Runs with every e2e suite (the release and beta gates, schedules, a gate by hand) and on a push that touches extension/ or e2e/recorded/ (lib/plan.mjs).
// Guarded by test/recorded-pages.test.mjs (the same replay locally: npm run recorded).
import {loadCases, runCase} from '../lib/page-replay.mjs';

export const name = 'recorded';
export const minutes = 6;
export const light = true;
export const needsChromium = true;   // CI installs Chromium for it (.github/workflows/e2e.yml)
export const keepGoing = true;

const cases = loadCases();
export const STEPS = cases.map(item => `${item.name}: ${item.shape}`);

export async function run(ctx) {
  await ctx.run('there are recorded cases to replay', async () => { if (!cases.length) throw new Error('desktop/e2e/recorded/ holds no case'); });
  for (const item of cases) {
    await ctx.run(`${item.name}: ${item.shape}`, async () => {
      const result = await runCase(item, {extensionDir: process.env.REAL_EXTENSION_DIR || undefined});
      if (!result.ok) throw new Error(`${item.name} (${item.why || ''}): ${result.failures.join('; ')}`);
    });
  }
}
