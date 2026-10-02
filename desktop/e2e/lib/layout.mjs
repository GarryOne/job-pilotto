/* global document, window, getComputedStyle */
// Visits pages the way a person does, waits for each to settle, takes a screenshot with the app's own facts beside it (for the AI review), and runs the
// deterministic layout checks. Findings of a suite are collected in ctx.findings and written once to ui-findings.json.
import fs from 'node:fs';
import path from 'node:path';
import {facts, settle} from './app.mjs';
import {writeFindings} from './artifacts.mjs';
import {LIMITS, inspect} from './uicheck.mjs';

// Look at one thing on screen that is already showing: screenshot `name`, facts, checks. `view` names the page for the checks.
export async function snap(ctx, name, {view, situation = 'default'} = {}) {
  const {page, session, ARTIFACTS} = ctx;
  const settled = await settle(page);
  if (!settled) ctx.findings.push({view: name, severity: 'warning', kind: 'stuck-loading', detail: `${name} still shows its loading state (skeleton or spinner) after 20 seconds`});
  await session.shot(`ui-${name}`);
  fs.writeFileSync(path.join(ARTIFACTS, `ui-${name}.json`), JSON.stringify({...await facts(page), situation}, null, 2));
  ctx.findings.push(...(await page.evaluate(inspect, {view: view || name, limits: LIMITS})).map(item => ({...item, view: name})));
}

export async function visit(ctx, views) {
  for (const view of views) {
    await ctx.page.click(`.nav[data-view="${view}"]`);
    await snap(ctx, view);
  }
}

// Severe findings fail the step; every finding is written for the nightly triage.
export function finish(ctx) {
  writeFindings(ctx);
  for (const finding of ctx.findings) console.log(`  ${finding.severity === 'severe' ? '✗' : '!'} [${finding.view}] ${finding.kind}: ${finding.detail}`);
  const severe = ctx.findings.filter(finding => finding.severity === 'severe');
  if (severe.length) throw new Error(`${severe.length} severe layout problem(s): ${severe.map(f => `${f.view}/${f.kind}`).join(', ')}`);
}
