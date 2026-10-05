/* global document, window */
// Strategy propagation: a change to the roles, places or companies to skip reaches ⚙️ Search settings (Notion), config/search.json and the next Jobs check,
// whichever side it was made on, and a reconnected app keeps the real settings instead of making new ones (2 Oct 2026: strategy changes never reached GitHub runs).
import {appModelEnv} from '../lib/engine.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {launch} from '../lib/app.mjs';
import {digestTitles} from '../lib/digest.mjs';
import {watch} from '../lib/activity.mjs';
import {emptyDatabase, ensureSection, findPagesBeside, pageSections, setSection, trashPage} from '../lib/notion.mjs';
import {forgetFixtureJobs} from '../lib/forget.mjs';
import {fastSeed, ensureSetUp} from '../lib/seed.mjs';

export const minutes = 30;
export const name = 'strategy';
const TITLE = '⚙️ Search settings';
const ROLE = 'zebra wrangler', GIRAFFE = 'giraffe keeper', PLACE = 'lugano', SKIP = 'E2E Initech';
const BASELINE_ROLE = 'Site Reliability Engineer';   // no fixture posting of this suite has it in its title
// Free words (no fixture feed depends on them): a company added on the Notion page and a region accepted in the app. A seeded run picks one of each, so a word an
// earlier run left behind can never make the "edit kept" check pass; every variant is removed first.
const EDITED = ['E2E Hooli', 'E2E Pied Piper', 'E2E Vandelay', 'E2E Globex'], REGIONS = ['atlantis', 'lemuria', 'hyperborea', 'avalon'];

export async function run(ctx) {
  const {page, token: NOTION} = ctx;
  const edited = ctx.vary.fixed ? EDITED[0] : ctx.vary.pick(EDITED), region = ctx.vary.fixed ? REGIONS[0] : ctx.vary.pick(REGIONS);
  if (!ctx.vary.fixed) console.log(`  variation: seed ${ctx.vary.seed}; edited on the page "${edited}", region "${region}"`);
  await ensureSetUp(ctx);
  const read = file => JSON.parse(fs.readFileSync(path.join(ctx.profile, 'config', file), 'utf8'));
  // The app links (or creates) the page a moment after it connects (lib/migrate.js runs in the background): wait for it.
  const linkedPage = async window_ => {
    for (let i = 0; i < 45; i++) {
      const id = await window_.evaluate(() => window.pilot.state()).then(s => s?.settings?.notionIds?.NOTION_SEARCH_SETTINGS_PAGE || '');
      if (id) return id;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return '';
  };
  // fastSeed connects Notion before "setup done" is saved, and the Notion-side moves (lib/migrate.js) only run for a finished setup: connect once more, as a user
  // reconnecting does, and they run.
  const reconnect = async window_ => {
    const done = await window_.evaluate(token => window.pilot.notionConnect(token), NOTION);
    if (!done?.ok) throw new Error(`Notion did not reconnect: ${done?.error}`);
  };
  const settingsPage = () => linkedPage(page);
  const profileId = await page.evaluate(() => window.pilot.state()).then(s => s.settings.notionIds.NOTION_PROFILE_PAGE_ID);
  const sections = async () => pageSections(NOTION, await settingsPage());
  const has = (list, word) => (list || []).some(entry => new RegExp(word, 'i').test(entry));

  // This suite is about which postings the crawl keeps, not about scoring them: the AI answers "no credit" locally, so it costs nothing and does not depend on the test key's limit.
  ctx.proxy.setMode('no-credit');
  // One Jobs check on the feeds in this suite; resolves with the titles its digest listed.
  const check = async () => {
    const engineLog = path.join(ctx.profile, 'logs', 'engine.log');
    const logStart = fs.existsSync(engineLog) ? fs.statSync(engineLog).size : 0;   // only what this check writes counts
    await page.click('.nav[data-view="jobs"]');
    await page.click('#refresh');
    const {samples, endedAt} = await watch(page, {every: 3000, maxMs: 420000});
    if (endedAt == null) throw new Error('the Jobs check was still running after 7 minutes');
    if (samples.at(-1).newest?.ok === false) throw new Error(`the Jobs check failed: ${samples.at(-1).newest.result}`);
    // What the check told the person: the digest it just wrote to the engine log (it exists whether or not the AI scored the jobs, and it is after the person's own filters).
    const log = path.join(ctx.profile, 'logs', 'engine.log');
    return digestTitles(fs.existsSync(log) ? fs.readFileSync(log).subarray(logStart).toString('utf8') : '');
  };
  // A new posting on one of the boards (the seen ones are not "new" again, so each check is judged on postings added just before it).
  const addPosting = (file, id, title, place = 'Lugano') => {
    const feed = path.join(ctx.feeds, file), data = JSON.parse(fs.readFileSync(feed, 'utf8'));
    data.jobs.push({id, title, location: {name: place}, absolute_url: `https://boards.e2e.test/job/${id}`, updated_at: '2026-10-02T09:00:00Z',
      content: `<p>${title}: run production on Kubernetes and AWS with Terraform, SLOs and on-call. Senior level, English working language, ${place}.</p>`});
    fs.writeFileSync(feed, JSON.stringify(data));
  };
  // Titles tell the two boards apart: "Senior …" is E2E Zebra's, "Staff …" is E2E Initech's.
  const listed = (jobs, word, level) => jobs.some(job => new RegExp(word, 'i').test(job) && (!level || job.startsWith(level)));

  await ctx.run('this suite starts with no jobs, two small boards and no strategy change', async () => {
    await emptyDatabase(NOTION, 'Job Matches — AI Scored');
    fs.mkdirSync(path.join(ctx.profile, 'config'), {recursive: true});
    fs.copyFileSync(path.join(ctx.E2E, 'fixtures', 'feeds', 'sources-strategy.json'), path.join(ctx.profile, 'config', 'sources.json'));
    await reconnect(page);
    const pageId = await settingsPage();
    if (!pageId) throw new Error('the app has no ⚙️ Search settings page id after setup');
    // Leftovers of older test runs (a duplicate page used to be made on every connect): keep only the one the app linked, so the checks below start clean.
    for (const extra of (await findPagesBeside(NOTION, profileId, TITLE)).filter(block => block.id.replace(/-/g, '') !== pageId.replace(/-/g, ''))) await trashPage(NOTION, extra.id);
    const found = await findPagesBeside(NOTION, profileId, TITLE);
    // A page left changed by an earlier run goes back to the plain strategy first.
    const now = await pageSections(NOTION, pageId);
    // A run that failed leaves its words on the page (5 Oct 2026: the suite then failed on every run, even on the last commit that had passed: one dirty page, kept dirty by each failure).
    // Everything found is removed, said in the log, and the app reconnects once more so the cleaned page is what it works from.
    const cleaned = [];
    for (const [heading, word] of [['Roles to look for', ROLE], ['Roles to look for', GIRAFFE], ['Best places', PLACE], ['Companies to skip', SKIP],
      ...EDITED.map(word => ['Companies to skip', word]), ...REGIONS.map(word => ['Remote jobs: regions to skip', word])]) {
      if (has(now[heading], word)) { cleaned.push(`${heading}: ${word}`); await setSection(NOTION, pageId, heading, (await pageSections(NOTION, pageId))[heading].filter(entry => !has([entry], word))); }
    }
    // An empty "Roles to look for" means every role matches: the cleanup above can leave it empty when the page held only the words this suite adds (5 Oct 2026: the check then kept all three
    // fixture postings, on the last good commit too). The page always has one baseline role that no fixture posting matches.
    if (!(((await pageSections(NOTION, pageId))['Roles to look for']) || []).length) { await setSection(NOTION, pageId, 'Roles to look for', [BASELINE_ROLE]); cleaned.push(`baseline role restored: ${BASELINE_ROLE}`); }
    if (cleaned.length) {
      console.log(`  the page had words left by an earlier run, or no role at all, fixed: ${cleaned.join(' | ')}`);
      const after = await pageSections(NOTION, pageId);
      const left = ['Roles to look for', 'Best places', 'Companies to skip'].flatMap(heading => (after[heading] || []).filter(entry => [ROLE, GIRAFFE, PLACE, SKIP].some(word => has([entry], word))).map(entry => `${heading}: ${entry}`));
      if (left.length) throw new Error(`the page still holds words of an earlier run after the cleanup: ${left.join(' | ')}`);
      await reconnect(page);   // the app takes the cleaned page, not the dirty one it read when it first connected
    }
    if (found.length !== 1 || found[0].id.replace(/-/g, '') !== pageId.replace(/-/g, '')) throw new Error(`expected exactly the linked ${TITLE} page, found ${found.length}`);
    // Connecting ran a Jobs check on whatever strategy the page held then (the previous run's end state: the Giraffe role). Wait for it, then forget what it kept, or the next
    // digest lists those postings as new although nobody asks for them any more.
    await page.waitForFunction(() => document.querySelector('#activity')?.dataset.state !== 'busy', null, {timeout: 120000});
    const forgotten = forgetFixtureJobs(ctx.profile);
    if (forgotten) console.log(`  forgot ${forgotten} fixture posting(s) kept by the connect-time check`);
  }, {needs: ctx.needs});

  await ctx.run('before any change the check finds neither new posting', async () => {
    const jobs = await check();
    if (listed(jobs, 'zebra|giraffe')) throw new Error(`jobs for roles nobody asked for were kept: ${jobs.filter(j => /zebra|giraffe/i.test(j)).join('; ')}`);
  }, {needs: ctx.needs});

  await ctx.run('a role and a place added in the app reach the Notion page and config/search.json', async () => {
    const added = await page.evaluate(terms => window.pilot.addRoles(terms), [ROLE]);
    if (!added?.ok || !added.added.includes(ROLE)) throw new Error(`addRoles: ${JSON.stringify(added)}`);
    const search = read('search.json'), preferences = read('preferences.json');
    const saved = await page.evaluate(draft => window.pilot.saveStrategy(draft, ['search']), {
      profile_markdown: 'Placeholder, not saved (only the search part is accepted).', answers_markdown: 'Placeholder.', contact: {},
      search: {locations: {...search.locations, top_tier: [...search.locations.top_tier, PLACE]}}, preferences});
    if (!saved?.ok) throw new Error(`saveStrategy: ${saved?.error}`);
    const file = read('search.json'), notion = await sections();
    if (!has(file.role_keywords, ROLE) || !has(file.locations.top_tier, PLACE)) throw new Error(`config/search.json lacks the new role or place (roles: ${file.role_keywords.join(', ')}; places: ${file.locations.top_tier.join(', ')})`);
    if (!has(notion['Roles to look for'], ROLE)) throw new Error(`the Notion page lacks the role (it lists: ${(notion['Roles to look for'] || []).join(', ')})`);
    if (!has(notion['Best places'], PLACE)) throw new Error(`the Notion page lacks the place (it lists: ${(notion['Best places'] || []).join(', ')})`);
  }, {needs: ctx.needs});

  await ctx.run('the next check keeps the posting that matches the new role and place, and still drops the other', async () => {
    const jobs = await check();
    if (!listed(jobs, 'zebra', 'Senior')) throw new Error(`the Zebra Wrangler posting was not kept (listed: ${jobs.join('; ') || 'nothing'})`);
    if (listed(jobs, 'giraffe')) throw new Error('the Giraffe Keeper posting was kept without anybody asking for that role');
    if (!listed(jobs, 'zebra', 'Staff')) throw new Error('the same role at the other board was not kept, although that company is not skipped yet');
  }, {needs: ctx.needs});

  await ctx.run('a company to skip, set in the app, reaches Notion and config/preferences.json', async () => {
    const search = read('search.json'), preferences = read('preferences.json');
    const saved = await page.evaluate(draft => window.pilot.saveStrategy(draft, ['filters']), {
      profile_markdown: 'Placeholder.', answers_markdown: 'Placeholder.', contact: {}, search,
      preferences: {...preferences, excluded_companies: [...(preferences.excluded_companies || []), SKIP]}});
    if (!saved?.ok) throw new Error(`saveStrategy: ${saved?.error}`);
    const notion = await sections();
    if (!has(read('preferences.json').excluded_companies, SKIP)) throw new Error('config/preferences.json lacks the company');
    if (!has(notion['Companies to skip'], SKIP)) throw new Error(`the Notion page lacks the company (it lists: ${(notion['Companies to skip'] || []).join(', ')})`);
    if (!has(notion['Roles to look for'], ROLE)) throw new Error('saving the companies lost the role added before');
  }, {needs: ctx.needs});

  await ctx.run('the skipped company is not kept any more, while the same role at the other board still is', async () => {
    addPosting('initech.json', 3102, 'Staff Zebra Wrangler, Platform');
    addPosting('zebra.json', 3005, 'Senior Zebra Wrangler, Data');
    const jobs = await check();
    if (listed(jobs, 'Platform', 'Staff')) throw new Error('a new posting from the skipped company was kept');
    if (!listed(jobs, 'Data', 'Senior')) throw new Error('a new posting from a company that is not skipped was lost');
  }, {needs: ctx.needs});

  await ctx.run('an edit made directly on the Notion page is used by the next check, and a removed role stops matching', async () => {
    const id = await settingsPage();
    const before = await sections();
    // The page is the source of truth: a person adds a role there, and takes the other one out.
    await setSection(NOTION, id, 'Roles to look for', [...before['Roles to look for'].filter(entry => !has([entry], ROLE)), GIRAFFE]);
    addPosting('zebra.json', 3006, 'Senior Zebra Wrangler, Cloud');
    addPosting('zebra.json', 3007, 'Senior Giraffe Keeper, Cloud');
    const jobs = await check();
    const file = read('search.json');
    if (!has(file.role_keywords, GIRAFFE) || has(file.role_keywords, ROLE)) throw new Error(`config/search.json did not follow the page: ${file.role_keywords.join(', ')}`);
    if (!listed(jobs, 'giraffe keeper, cloud')) throw new Error(`the role added in Notion found nothing (listed: ${jobs.join('; ') || 'nothing'})`);
    if (listed(jobs, 'zebra wrangler, cloud')) throw new Error('the role removed in Notion still matches a new posting');
  }, {needs: ctx.needs});

  await ctx.run('a region word and a level written on the Notion page decide which postings the next check keeps', async () => {
    const id = await settingsPage();
    const before = await sections();
    const places = before['Best places'] || [], level = before['Your level'] || [];
    try {
      // "Ticino" is a region word (src/regions.py): a posting in Bellinzona has no "lugano" in it. "junior" skips the titles that plainly name a senior role.
      await setSection(NOTION, id, 'Best places', ['Ticino']);
      await ensureSection(NOTION, id, 'Your level', ['junior']);
      addPosting('zebra.json', 3008, 'Junior Giraffe Keeper, Nord', 'Bellinzona');
      addPosting('zebra.json', 3009, 'Senior Giraffe Keeper, Nord', 'Bellinzona');
      addPosting('zebra.json', 3010, 'Junior Giraffe Keeper, Sued', 'Zurich, Switzerland');
      const jobs = await check();
      const file = read('search.json');
      if (!has(file.locations?.top_tier, 'ticino') || !has(file.level, 'junior')) throw new Error(`config/search.json did not follow the page: places ${(file.locations?.top_tier || []).join(', ')}; level ${(file.level || []).join(', ') || 'none'}`);
      if (!listed(jobs, 'junior giraffe keeper, nord')) throw new Error(`a posting in Bellinzona was not kept for the region "Ticino" (listed: ${jobs.join('; ') || 'nothing'})`);
      if (listed(jobs, 'senior giraffe keeper, nord')) throw new Error('the level "junior" still kept a Senior title');
      if (listed(jobs, 'giraffe keeper, sued')) throw new Error('a posting in Zurich was kept for the region "Ticino"');
    } finally {
      await setSection(NOTION, id, 'Best places', places);     // the next steps start from the page as it was
      await setSection(NOTION, id, 'Your level', level);       // an empty list: the heading stays with no bullets, which means no level
    }
  }, {needs: ctx.needs});

  await ctx.run('accepting a strategy change in the app keeps what was edited on the Notion page meanwhile', async () => {
    const id = await settingsPage();
    const before = await pageSections(NOTION, id);
    await setSection(NOTION, id, 'Companies to skip', [...(before['Companies to skip'] || []), edited]);   // edited in Notion, no check has run since
    const search = read('search.json');
    const saved = await page.evaluate(draft => window.pilot.saveStrategy(draft, ['search']), {
      profile_markdown: 'Placeholder.', answers_markdown: 'Placeholder.', contact: {}, search: {...search, remote_excluded_regions: [...(search.remote_excluded_regions || []), region]}, preferences: {}});
    if (!saved?.ok) throw new Error(`saveStrategy: ${saved?.error}`);
    const after = await pageSections(NOTION, id);
    if (!has(after['Companies to skip'], edited)) throw new Error('the edit made on the Notion page was overwritten when a strategy change was accepted');
    if (!has(after['Remote jobs: regions to skip'], region)) throw new Error('the accepted change did not reach the page');
  }, {needs: ctx.needs});

  await ctx.run('a fresh install reconnecting to the same Notion page keeps the real settings and links the same page', async () => {
    const id = await settingsPage();
    const wanted = await sections();
    await ctx.session.close();
    const again = await launch({env: {...appModelEnv(), JOB_PILOTTO_FIXTURE_DIR: ctx.feeds, JOB_PILOTTO_E2E_AI_BASE_URL: ctx.proxy.url}});
    try {
      await fastSeed({...ctx, page: again.page, profile: again.profile});
      await reconnect(again.page);
      const linked = await linkedPage(again.page);
      await new Promise(resolve => setTimeout(resolve, 10000));   // a second, duplicate page would be made in this window
      const found = await findPagesBeside(NOTION, profileId, TITLE);
      if (linked.replace(/-/g, '') !== id.replace(/-/g, '')) throw new Error(`the reconnected app linked a different page (${linked} instead of ${id})`);
      if (found.length !== 1) throw new Error(`${found.length} "${TITLE}" pages exist after reconnecting`);
      const now = await pageSections(NOTION, id);
      if (JSON.stringify(now) !== JSON.stringify(wanted)) throw new Error('reconnecting changed the settings on the Notion page');
      // The new profile has no config yet: the first crawl takes the page, so the real settings are what the engine uses.
      const synced = await again.page.evaluate(() => window.pilot.addRoles([]));
      if (synced?.ok === false) throw new Error(`addRoles: ${synced.error}`);
    } finally { await again.close(); }
  }, {needs: ctx.needs});
}
