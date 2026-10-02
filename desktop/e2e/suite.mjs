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
  for (const suite of chosen) include.push({suite, minutes: (await import(`./suites/${suite}.mjs`)).minutes || 15});
  console.log(JSON.stringify({include}));
  process.exit(0);
}
process.env.E2E_SUITE = name;   // read when lib/app.mjs loads: each suite writes its own artifacts folder
const {assertNothingQueued} = await import('./lib/app.mjs');
const {SUITES, openContext} = await import('./lib/context.mjs');
const {writeFindings, writeSuiteFailures} = await import('./lib/artifacts.mjs');
if (!SUITES.includes(name)) { console.error(`usage: node suite.mjs ${SUITES.join('|')}`); process.exit(2); }
const suite = await import(`./suites/${name}.mjs`);
let ctx;
try {
  ctx = await openContext(name, {fresh: !!suite.fresh, env: suite.env, browser: !!suite.browser});
  if (ctx.skipAll) {
    console.log(`The ${name} suite is skipped: ${ctx.needs.filter(item => !item.value).map(item => item.name).join(' and ')} not set.`);
    process.exit(0);
  }
  await suite.run(ctx);
  await ctx.run('nothing was queued to report to the product', async () => { assertNothingQueued(ctx.profile); });
} catch (error) {
  if (!ctx?.runner.results.some(result => result.status === 'failed')) console.log(`✗ the ${name} suite stopped: ${error.message}`);
  process.exitCode = 1;
} finally {
  // For the nightly loop, whatever happened: the layout findings so far, and the steps that failed (a suite that stops early used to leave neither).
  if (ctx && !ctx.skipAll) { try { if (ctx.findings) writeFindings(ctx); writeSuiteFailures(ctx.ARTIFACTS, name, ctx.runner.results); } catch (error) { console.log(`  (artifacts not written: ${error.message})`); } }
  if (ctx && !ctx.skipAll) { await ctx.close(); const code = ctx.runner.summary(); if (code) process.exitCode = 1; }
  // The app and Playwright can leave handles open: exit explicitly, never hang a CI job.
  process.exit(process.exitCode || 0);
}
