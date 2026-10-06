// Runs one suite of the end-to-end tests:   node suite.mjs wizard|jobs|interviews|settings
// A suite may export `env` (extra environment for the app) and `fresh` (empty its Notion page first).
// Each suite has its own Notion test page and starts from its own state (see README.md), so suites can run at the same time.
const name = process.argv[2];
// The CI matrix is built from the suites that exist:   node suite.mjs --list
if (name === '--list') {
  const {SUITES: all} = await import('./lib/context.mjs');
  const {suitesFor, suitesNamed} = await import('./lib/plan.mjs');
  const option = flag => { const at = process.argv.indexOf(flag); return at < 0 ? null : process.argv[at + 1] || ''; };
  // --changed: the changed files, one per line on stdin (a push); --only a,b: a manual run's choice; neither: every suite.
  const {autoSuites} = await import('./lib/plan.mjs');
  const cadence = {}, watches = {};
  for (const suite of all) { const module = await import(`./suites/${suite}.mjs`); if (module.cadence) cadence[suite] = module.cadence; if (module.watches) watches[suite] = module.watches; }
  const named = option('--only');
  const chosen = process.argv.includes('--changed') ? suitesFor((await import('node:fs')).readFileSync(0, 'utf8').split('\n'), all, {watches, cadence}) : named ? suitesNamed(named, all) : autoSuites(all, cadence);
  const include = [];
  const {runnerOf} = await import('./lib/plan.mjs');
  for (const suite of chosen) { const module = await import(`./suites/${suite}.mjs`); include.push({suite, minutes: module.minutes || 15, os: runnerOf(module)}); }
  console.log(JSON.stringify({include}));
  process.exit(0);
}
process.env.JOB_PILOTTO_E2E_SUITE = name;   // the app tags its Sentry reports with it (lib/sentry.js e2eTags)
process.env.E2E_SUITE = name;   // read when lib/app.mjs loads: each suite writes its own artifacts folder
// A hard stop for the whole process (6 Oct 2026: a Windows jobs suite ran 14+ min after its last step failed: something outside the steps hung, closing the app
// or a test server). The runner cuts steps at the 7-minute budget; nothing may outlive it by more than 3 minutes. unref: a suite that ends earlier exits as usual.
{
  const {SUITE_BUDGET_MS} = await import('./lib/runner.mjs');
  const stopAt = SUITE_BUDGET_MS + 3 * 60000;
  setTimeout(() => {
    console.log(`✗ the ${name} suite was still running ${Math.round(stopAt / 60000)} min after it started: stopped by force (something outside the steps hung: closing the app, a test server, or writing artifacts)`);
    process.exit(1);
  }, stopAt).unref();
}
const {assertNothingQueued} = await import('./lib/app.mjs');
const {SUITES, openContext} = await import('./lib/context.mjs');
const {writeFindings, writeReplay, writeSuiteFailures} = await import('./lib/artifacts.mjs');
const {skipExitCode, skipMessage} = await import('./lib/skip.mjs');
if (!SUITES.includes(name)) { console.error(`usage: node suite.mjs ${SUITES.join('|')}`); process.exit(2); }
const suite = await import(`./suites/${name}.mjs`);
let ctx;
try {
  ctx = await openContext(name, {engine: suite.engine, fresh: !!suite.fresh, env: suite.env, browser: !!suite.browser, light: !!suite.light, notionProxy: !!suite.notionProxy, telegram: !!suite.telegram, google: !!suite.google, budgetMinutes: suite.budgetMinutes || 0, stepNeeds: suite.stepNeeds || {}, releases: !!suite.releases, notionStandIn: !!suite.notionStandIn || process.env.E2E_NOTION_STANDIN === '1', notionTokenOf: suite.notionTokenOf || '', notion: suite.notion !== false, keepGoing: !!suite.keepGoing, variesPlace: !!suite.variesPlace});
  if (ctx.skipAll) {
    console.log(skipMessage(name, ctx.needs.filter(item => !item.value).map(item => item.name)));
    process.exit(skipExitCode());
  }
  await suite.run(ctx);
  if (!suite.light) await ctx.run('nothing was queued to report to the product', async () => { assertNothingQueued(ctx.profile); });   // a light suite has no app
} catch (error) {
  if (!ctx?.runner.results.some(result => result.status === 'failed')) console.log(`✗ the ${name} suite stopped: ${error.message}`);
  process.exitCode = 1;
} finally {
  // For the nightly loop, whatever happened: the layout findings so far, and the steps that failed (a suite that stops early used to leave neither).
  // Errors over the whole suite (lib/journey.mjs): added to its findings, so even a suite without layout checks reports a renderer exception.
  if (ctx && !ctx.skipAll && !suite.light) {
    const {journey, journeyFindings} = await import('./lib/journey.mjs');
    const extra = journeyFindings(journey, {suite: name, expectsFailures: !!suite.env?.JOB_PILOTTO_E2E_EXPECTS_FAILURES});
    if (extra.length) { ctx.findings = [...(ctx.findings || []), ...extra]; console.log(`  journey: ${extra.map(item => item.detail).join(' | ')}`); }
    // Accessibility: one finding per axe rule over the suite's pages; a11y.json says what was checked, so the Finder can clear a rule that is gone.
    if (ctx.a11y?.checked) {
      const {a11yFindings} = await import('./lib/a11y.mjs');
      const found = a11yFindings(ctx.a11y);
      if (found.length) ctx.findings = [...(ctx.findings || []), ...found];
      (await import('node:fs')).writeFileSync((await import('node:path')).join(ctx.ARTIFACTS, 'a11y.json'), JSON.stringify({checked: ctx.a11y.checked, rules: Object.keys(ctx.a11y.rules || {})}, null, 2));
    }
  }
  if (ctx && !ctx.skipAll) { try { if (ctx.findings) writeFindings(ctx); writeSuiteFailures(ctx.ARTIFACTS, name, ctx.runner.results); } catch (error) { console.log(`  (artifacts not written: ${error.message})`); } }
  if (ctx && !ctx.skipAll) { try { await writeReplay(ctx, name); } catch (error) { console.log(`  (replay.json not written: ${error.message})`); } }
  if (ctx && !ctx.skipAll) { await ctx.close(); const code = ctx.runner.summary(); if (code) process.exitCode = 1; }
  // The app and Playwright can leave handles open: exit explicitly, never hang a CI job.
  process.exit(process.exitCode || 0);
}
