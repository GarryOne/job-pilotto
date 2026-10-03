// Interactions: what each safe control of every page DOES when pressed. A click that changes nothing and reaches nothing, an expandable that does not expand, an action that
// runs seconds with no sign of work and a click that throws are found from recorded behaviour (page changes, the window's calls to the app, errors), not from a picture.
// Nothing that deletes, sends, signs in, leaves the app or spends AI credit is ever pressed (lib/interact.mjs isSafe). Starts from a set-up install.
import fs from 'node:fs';
import path from 'node:path';
import {finish, visitNarrow} from '../lib/layout.mjs';
import {probePage} from '../lib/interact.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {settle} from '../lib/app.mjs';
import {VIEWS} from '../lib/uicheck.mjs';

export const name = 'interactions';
export const minutes = 10;
export const watches = ['desktop/renderer/', 'desktop/lib/e2e-ipc.js'];

export async function run(ctx) {
  const {page, app, ARTIFACTS} = ctx;
  ctx.findings = [];
  const all = [];
  await ensureSetUp(ctx);
  // The calls the window made to the app, recorded by main.js in an end-to-end run (lib/e2e-ipc.js).
  const ipc = {
    mark: () => app.evaluate(() => (globalThis.__jpIpc || []).length),
    since: mark => app.evaluate((_electron, from) => (globalThis.__jpIpc || []).slice(from).map(({channel, start, ms, failed}) => ({channel, start, ms, failed})), mark),
  };
  let shots = 0;
  for (const view of VIEWS) {
    await ctx.run(`${view}: every safe control does something`, async () => {
      await page.click(`.nav[data-view="${view}"]`);
      await settle(page);
      const {results, findings, skipped} = await probePage({page, view, ipc, scope: `.view[data-view="${view}"]`, reset: async () => { await page.click(`.nav[data-view="${view}"]`); await settle(page); },
        onFlag: async (_control, flagged) => { const shot = `probe-${view}-${++shots}`; await ctx.session.shot(`ui-${shot}`); for (const item of flagged) item.shot = shot; }});
      all.push(...results.map(item => ({...item, view})));
      ctx.findings.push(...findings);
      console.log(`  ${view}: ${results.length} controls pressed, ${findings.length} flagged, ${skipped.length} left alone (${skipped.slice(0, 6).join(' | ')})`);
    }, {needs: ctx.needs});
  }
  await ctx.run('the narrowest window: the sidebar is an icon rail and every page still fits', async () => {
    await visitNarrow(ctx, ['focus', 'jobs', 'actions', 'settings']);
  }, {needs: ctx.needs});
  fs.writeFileSync(path.join(ARTIFACTS, 'interactions.json'), JSON.stringify(all, null, 2));
  await ctx.run('interaction findings are written', async () => {
    if (!all.length) throw new Error('the probe pressed no control on any page: it found nothing to test');
    finish(ctx);
  }, {needs: ctx.needs});
}
