/* global window */
// Actions + Recent activity + Jobs: the core of every workflow. Starts from a set-up install; resets only its own data (jobs and run rows) in Notion.
import fs from 'node:fs';
import path from 'node:path';
import {longestSilence, watch} from '../lib/activity.mjs';
import {emptyDatabase, findPage} from '../lib/notion.mjs';
import {finish, visit} from '../lib/layout.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {varyFeeds} from '../lib/feeds.mjs';

export const minutes = 30;
export const name = 'jobs';
export async function run(ctx) {
  const {proxy, feeds, token: NOTION, ARTIFACTS} = ctx;
  let {page} = ctx;
  ctx.findings = [];
  await ensureSetUp(ctx);
  await ctx.run("the app's next start links this workspace's Search settings page (so the check looks for this person's roles and places)", async () => {
    // The fast seed connects Notion and marks setup done without a restart; the app links the existing Search settings page in its start-up migration (migrate.js), which is
    // what a real person's next start does. Without it the engine keeps the example config (a data analyst in Amsterdam), drops every fixture job and the check finds "0 new jobs"
    // (CI, 2 Oct 2026).
    await ctx.relaunch();
    page = ctx.page;
    await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    let linked = null;
    for (let waited = 0; !linked && waited < 60000; waited += 2000) {
      linked = await page.evaluate(async () => (await window.pilot.state()).settings?.notionIds?.NOTION_SEARCH_SETTINGS_PAGE || null);
      if (!linked) await page.waitForTimeout(2000);
    }
    if (!linked) throw new Error("the app did not link this workspace's Search settings page within a minute of starting");
  }, {needs: ctx.needs});
  await ctx.run('this suite starts with no jobs and no runs in its Notion page', async () => {
    const rows = [await emptyDatabase(NOTION, 'Job Matches — AI Scored'), await emptyDatabase(NOTION, 'Cronjob Runs')];
    console.log(`  cleared ${rows[0]} job row(s) and ${rows[1]} run row(s)`);
    // The app listed last run's fixture jobs when it started; read the list again, or the next step sees them, passes at once and never waits for its check.
    await page.reload();
    await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    await page.waitForFunction(() => Array.isArray(window.__jp?.shared?.allJobs) && !window.__jp.shared.allJobs.some(job => /^E2E /.test(job.company || '')), null, {timeout: 60000, polling: 1000})
      .catch(() => { throw new Error('the app still lists fixture jobs after their rows were cleared'); });
  }, {needs: ctx.needs});
  await ctx.run('a jobs check reads the fixture feeds, drops the wrong roles and scores the matching jobs', async () => {
    // The employers to crawl: two fixture boards (feeds come from fixtures/feeds, never the network).
    fs.mkdirSync(path.join(ctx.profile, 'config'), {recursive: true});
    fs.copyFileSync(path.join(ctx.E2E, 'fixtures', 'feeds', 'sources.json'), path.join(ctx.profile, 'config', 'sources.json'));
    const varied = varyFeeds(ctx.feeds, ctx.vary);   // a seeded run: one more match, one more wrong role, Zurich written another way (lib/feeds.mjs)
    if (varied) {   // replay: E2E_SEED=<seed> node suite.mjs jobs (issues show the seed from seed.json)
      console.log(`  variation: seed ${ctx.vary.seed}; ${varied.note}`);
      fs.writeFileSync(path.join(ARTIFACTS, 'seed.json'), JSON.stringify({seed: ctx.vary.seed, fixed: false, detail: varied.note}));
    }
    await page.click('.nav[data-view="jobs"]');
    await page.click('#refresh');
    // Only the fixture employers' jobs (E2E …) count: the app's list also holds this workspace's own application records, scored long ago, which made this wait pass at once
    // and the slow check below join a check still in flight (CI, 2 Oct 2026: "0 new jobs", no AI call).
    const scored = () => page.evaluate(() => (window.__jp.shared.allJobs || []).filter(job => /^E2E /.test(job.company || '') && job.title && job.fit != null && job.fit !== '').map(job => ({title: job.title, fit: Number(job.fit)})));
    await page.waitForFunction(() => (window.__jp.shared.allJobs || []).some(job => /^E2E /.test(job.company || '') && /reliability|devops|platform/i.test(job.title) && job.fit != null && job.fit !== ''),
      null, {timeout: 480000, polling: 3000});
    const jobs = await scored();
    const titles = jobs.map(job => job.title);
    console.log(`  scored: ${jobs.map(job => `${job.title} (${job.fit})`).join('; ')}`);
    if (jobs.some(job => !(job.fit >= 0 && job.fit <= 100))) throw new Error('a score is outside 0 to 100');
    const wrong = titles.filter(title => /account executive|product designer|intern/i.test(title));
    if (wrong.length) throw new Error(`jobs for the wrong role were kept: ${wrong.join(', ')}`);
    if (varied) {   // the added match is kept and scored like the written ones, whatever way Zurich is written
      const has = async () => (await scored()).some(job => job.title === varied.match);
      for (let waited = 0; !(await has()) && waited < 120000; waited += 5000) await page.waitForTimeout(5000);
      if (!(await has())) throw new Error(`the added match "${varied.match}" (in "${varied.place}") was not kept and scored; scored: ${(await scored()).map(job => job.title).join('; ')}`);
    }
  }, {needs: ctx.needs});
  await ctx.run('Find new employers probes the seed company and lists it in Notion', async () => {
    fs.copyFileSync(path.join(ctx.E2E, 'fixtures', 'feeds', 'scout_seeds.json'), path.join(ctx.profile, 'config', 'scout_seeds.json'));
    await page.click('.nav[data-view="actions"]');
    await page.click('[data-command="scout"]');
    const started = Date.now();
    let listed = null;
    while (!listed && Date.now() - started < 240000) {
      listed = await findPage(NOTION, 'E2E Gamma').catch(() => null);
      if (!listed) await page.waitForTimeout(4000);
    }
    if (!listed) throw new Error('"E2E Gamma" was not listed in Notion (Employers & Sources) within 4 minutes');
  }, {needs: ctx.needs});
  await ctx.run('a slow Jobs check keeps showing that it is working, and ends cleanly', async () => {
    // Four new matching postings appear, and every AI call now takes 8 seconds: the shape of a friend's 35-minute check (2 Oct 2026).
    const acme = JSON.parse(fs.readFileSync(path.join(feeds, 'acme.json'), 'utf8'));
    const more = ['Senior Site Reliability Engineer, Payments', 'Staff Platform Engineer, Observability', 'Senior DevOps Engineer, Cloud', 'Senior Infrastructure Engineer, Kubernetes'];
    more.forEach((title, i) => acme.jobs.push({id: 1100 + i, title, location: {name: 'Zurich, Switzerland'}, absolute_url: `https://boards.e2e.test/job/${1100 + i}`, updated_at: '2026-10-02T09:00:00Z',
      content: `<p>${title}: run production on Kubernetes and AWS with Terraform, SLOs and on-call. Senior level, hybrid in Zurich, English working language.</p>`}));
    fs.writeFileSync(path.join(feeds, 'acme.json'), JSON.stringify(acme));
    proxy.setDelay(8000);
    const callsBefore = proxy.stats.calls;
    await page.click('.nav[data-view="actions"]');
    await page.click('[data-command="run"]');
    const t0 = Date.now();
    let opened = false;
    const {samples, endedAt} = await watch(page, {onSample: async (s, all) => {
      if (!opened && s.banner.shown) { opened = true; await page.click('#run-banner-view').catch(() => {}); }
      console.log(`  +${String(Math.round((s.at - t0) / 1000)).padStart(3)}s running=${s.running ? 'yes' : 'no '} banner=${s.banner.shown ? 'yes' : 'no '} log=${s.logShown} unscored=${s.unscored}/${s.jobs} step="${(s.running?.step || s.panelStep).slice(0, 56)}"`);
    }});
    proxy.setDelay(0);
    const running = samples.filter(s => s.running);
    const problems = [];
    if (!running.length) problems.push('the task never showed as running');
    if (!samples.some(s => s.banner.shown)) problems.push('no "running" banner appeared on the Actions page');
    const firstLog = running.find(s => s.logShown > 0);
    if (!firstLog) problems.push('the Technical log never showed a line while the task ran ("Nothing to show yet" the whole time)');
    else if (firstLog.at - running[0].at > 40000) problems.push(`the Technical log showed nothing for the first ${Math.round((firstLog.at - running[0].at) / 1000)} s`);
    const silence = longestSilence(samples);
    console.log(`  longest stretch with nothing visibly changing: ${Math.round(silence / 1000)} s; AI calls through the slow proxy: ${proxy.stats.calls - callsBefore}`);
    if (silence > 60000) problems.push(`nothing visibly changed for ${Math.round(silence / 1000)} s while the task was running`);
    if (endedAt == null) problems.push('the task was still running after 6 minutes');
    const last = samples.at(-1);
    if (endedAt != null && (last.newest?.live || last.newest?.ok === false)) problems.push(`the task ended but the newest run is ${last.newest?.live ? 'still live' : 'failed'}: ${last.newest?.result}`);
    if (endedAt != null && last.unscored > 0) problems.push(`${last.unscored} job(s) are still "Not scored" after the task ended`);
    if (proxy.stats.calls - callsBefore < 1) problems.push('the test never reached the slow AI path (no AI call went through the proxy)');
    if (problems.length) throw new Error(problems.join('; '));
  }, {needs: ctx.needs});
  await ctx.run('the pages of this suite render without layout problems', async () => {
    await visit(ctx, ['focus', 'jobs', 'actions']);
    finish(ctx);
  }, {needs: ctx.needs});
}
