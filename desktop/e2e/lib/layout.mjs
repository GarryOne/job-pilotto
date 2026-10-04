/* global document */
// Visits pages the way a person does, waits for each to settle, takes a screenshot with the app's own facts beside it (for the AI review), and runs the
// deterministic layout checks. Findings of a suite are collected in ctx.findings and written once to ui-findings.json.
import fs from 'node:fs';
import path from 'node:path';
import {facts, settle} from './app.mjs';
import {writeFindings} from './artifacts.mjs';
import {LIMITS, inspect, motionFacts} from './uicheck.mjs';
import {checkA11y, tally} from './a11y.mjs';

// Look at one thing on screen that is already showing: screenshot `name`, facts, checks. `view` names the page for the checks.
// `busy`: a task is running on purpose, so its spinner is not a page stuck loading.
export async function snap(ctx, name, {view, situation = 'default', busy = false} = {}) {
  const {page, session, ARTIFACTS} = ctx;
  const settled = busy ? true : await settle(page);
  if (!settled) ctx.findings.push({view: name, severity: 'warning', kind: 'stuck-loading', detail: `${name} still shows its loading state (skeleton or spinner) after 20 seconds`});
  await session.shot(`ui-${name}`);
  fs.writeFileSync(path.join(ARTIFACTS, `ui-${name}.json`), JSON.stringify({...await facts(page), ...await page.evaluate(motionFacts).catch(() => ({})), situation}, null, 2));
  tally((ctx.a11y ??= {}), name, await checkA11y(page));   // accessibility (lib/a11y.mjs): tallied per rule, filed once per rule when the suite ends
  ctx.findings.push(...(await page.evaluate(inspect, {view: view || name, limits: LIMITS})).map(item => ({...item, view: item.chrome ? 'app-chrome' : name, shot: name})));   // the sidebar and the bottom bar are on every page: one finding, not one per page
}

export async function visit(ctx, views) {
  for (const view of views) {
    await ctx.page.click(`.nav[data-view="${view}"]`);
    await snap(ctx, view);
  }
}

// The app's narrowest window (main.js minWidth 1024): the sidebar becomes an icon rail under 1180 px, a state the 1280 px default never shows and where
// the sidebar's text spilled out. Visits `views` there with their own screenshots (<view>-narrow, so the AI review judges them too), then restores the size.
// Findings are downgraded to warnings: the pass files issues, it does not fail a journey (nor hold a release) the first time it looks.
export async function visitNarrow(ctx, views, {width = 1024, height = 640, take = snap} = {}) {   // 640: the app's smallest height (main.js minHeight), where the menu is cut off (owner, 4 Oct 2026)
  const resize = size => ctx.app.evaluate(({BrowserWindow}, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; const was = win.getSize(); win.setSize(w, h); return was; }, size);
  const was = await resize([width, height]);
  try {
    const railed = await ctx.page.waitForFunction(() => document.querySelector('.app')?.classList.contains('rail'), null, {timeout: 10000}).then(() => true, () => false);
    if (!railed) ctx.findings.push({view: 'app-chrome', severity: 'warning', kind: 'layout', detail: `the sidebar did not become an icon rail at ${width} px wide (sidebar-rail.js: under 1180 px)`});
    for (const view of views) {
      const before = ctx.findings.length;
      await ctx.page.click(`.nav[data-view="${view}"]`);
      await take(ctx, `${view}-narrow`, {view});
      for (const finding of ctx.findings.slice(before)) finding.severity = 'warning';
    }
  } finally {
    await resize(was);
  }
}

// Severe findings fail the step; every finding is written for the nightly triage.
export function finish(ctx) {
  writeFindings(ctx);
  for (const finding of ctx.findings) console.log(`  ${finding.severity === 'severe' ? '✗' : '!'} [${finding.view}] ${finding.kind}: ${finding.detail}`);
  const severe = ctx.findings.filter(finding => finding.severity === 'severe');
  if (severe.length) throw new Error(`${severe.length} severe layout problem(s): ${severe.map(f => `${f.view}/${f.kind}`).join(', ')}`);
}
