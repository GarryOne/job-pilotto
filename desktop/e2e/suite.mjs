// Runs one suite of the end-to-end tests:   node suite.mjs wizard|jobs|interviews|settings
// A suite may export `env` (extra environment for the app) and `fresh` (empty its Notion page first).
// Each suite has its own Notion test page and starts from its own state (see README.md), so suites can run at the same time.
const name = process.argv[2];
// The CI matrix is built from the suites that exist:   node suite.mjs --list
if (name === '--list') {
  const {SUITES: all} = await import('./lib/context.mjs');
  const include = [];
  for (const suite of all) include.push({suite, minutes: (await import(`./suites/${suite}.mjs`)).minutes || 15});
  console.log(JSON.stringify({include}));
  process.exit(0);
}
process.env.E2E_SUITE = name;   // read when lib/app.mjs loads: each suite writes its own artifacts folder
const {assertNothingQueued} = await import('./lib/app.mjs');
const {SUITES, openContext} = await import('./lib/context.mjs');
if (!SUITES.includes(name)) { console.error(`usage: node suite.mjs ${SUITES.join('|')}`); process.exit(2); }
const suite = await import(`./suites/${name}.mjs`);
let ctx;
try {
  ctx = await openContext(name, {fresh: !!suite.fresh, env: suite.env});
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
  if (ctx && !ctx.skipAll) { await ctx.close(); const code = ctx.runner.summary(); if (code) process.exitCode = 1; }
  // The app and Playwright can leave handles open: exit explicitly, never hang a CI job.
  process.exit(process.exitCode || 0);
}
