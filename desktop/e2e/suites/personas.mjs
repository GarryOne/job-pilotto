/* global document, window */
// Personas: nothing in the product is hard-coded to its first user (a Swiss SRE who is an EU citizen). Two fictional people, one after the other in the
// same install and Notion page: a data analyst in Austin (US citizen) and a marketing manager in São Paulo (Brazilian, open to Portugal and Spain, visa needed).
// Each gets the real strategy path (the app's own saveStrategy, as the wizard's review does), a jobs check on fixture feeds in THEIR places, and Find new
// employers. Then the whole product is read for what it says: the UI, the digest and the Notion pages and rows are grepped for the forbidden list, the visa
// flag must follow citizenship and target places, the search regions and the Google Jobs places must be theirs, board discovery must be skipped, and a salary
// must keep the posting's own currency. Fixtures: fixtures/personas/<name>/ (make-personas.py).
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {DESKTOP} from '../lib/app.mjs';
import {databaseText, emptyDatabase, findPage, pageText} from '../lib/notion.mjs';
import {ensureSetUp} from '../lib/seed.mjs';

export const minutes = 40;
// MANUAL (2 Oct 2026, kept, not deleted): It proves nothing is hard-coded to the owner (Swiss/EU wording, visa flag, currencies): one-time hygiene that costs 15 minutes and two
// full AI runs each time. No schedule, push or release gate runs it (cadence 'manual', lib/plan.mjs); run it by hand when a change could bring owner-specific text back:
//   gh workflow run e2e.yml -f suite=personas        or        node suite.mjs personas
export const cadence = 'manual';
export const name = 'personas';

// Words that belong to the first user, not to the product. Anywhere in what a persona sees or what is stored for them, each is a bug.
export const FORBIDDEN = /switzerland|swiss|schweiz|suisse|z[uü]rich|🇨🇭|\bCHF\b|\bEU\b|european union|\bEEA\b/i;

const REPO = path.resolve(DESKTOP, '..');
const personaDir = key => path.join(DESKTOP, 'e2e', 'fixtures', 'personas', key);
const PERSONAS = ['austin', 'sao_paulo'];

// The engine's own code, run against this install's folders: what the digest and the settings say for this user.
function engine(ctx, code, args = []) {
  const env = {...process.env, JOB_PILOTTO_NO_DOTENV: '1', JOB_PILOTTO_CONFIG_DIR: path.join(ctx.profile, 'config'), JOB_PILOTTO_DATA_DIR: path.join(ctx.profile, 'data'), PYTHONUTF8: '1'};
  for (const name of Object.keys(env)) if (/^(NOTION_|TELEGRAM_|SERPAPI)/.test(name)) delete env[name];
  return execFileSync(process.env.E2E_PYTHON || 'python3', ['-c', code, ...args], {cwd: REPO, env, encoding: 'utf8', timeout: 120000});
}
const DIGEST_CODE = `
import json, sys
from src import digest, store
from src.paths import JOBS_DB, load_search_config
from src.sources import google_jobs
db = store.connect(JOBS_DB)
fits = digest.score.load(db)
# the digest leaves out jobs scored below digest_min_score (build_digest does the same): only the jobs it can show are under test
jobs = [j for j in digest.eligible_jobs(db)[0] if not (fits.get(j['id']) and fits[j['id']]['score'] < digest.MIN_DIGEST_SCORE)]
search = load_search_config()
print(json.dumps({'text': digest.format_digest(db, limit=50),
  'jobs': [{'title': j['title'], 'location': j.get('location') or '', 'sponsorship': digest.needs_sponsorship(j), 'inPlaces': digest.in_places(j), 'salary': digest._salary(j.get('description') or '') or ''} for j in jobs],
  'google': {'places': google_jobs.places(google_jobs.settings(search)), 'country': google_jobs.settings(search).get('country')}}))
`;

function draftOf(profile) {
  const markdown = `# Hard constraints

| Constraint | Value |
|---|---|
| Countries | ${profile.places.country_wide.slice(0, 2).join(', ')} |
| Home base | ${profile.places.top_tier[0]} |
| Work mode | On-site, hybrid or remote |
| Work permit / visa | ${profile.citizenship} citizen; ${profile.work_rights.join(', ')}. Needs sponsorship elsewhere |
| Languages I can work in | ${profile.languages.join(', ')} |
| Minimum seniority | Senior |

# Compensation

- Minimum acceptable: ❓
`;
  return {summary: `Roles for ${profile.name}.`, goals: {seniority: 'Senior', work_mode: 'On-site, hybrid or remote', minimum_salary: '', languages: profile.languages.join(', ')},
    profile_markdown: markdown, answers_markdown: `# Eligibility\n\n- Work authorisation: ${profile.citizenship} citizen\n`, open_questions: [],
    search: {role_keywords: profile.roles, title_exclude_keywords: ['\\bintern(ship)?\\b', '\\bsales\\b', 'est[aá]gio', 'designer'], board_discovery_keywords: [profile.board],
      jobs_board_search_queries: profile.roles.slice(0, 2), quality_stack_keywords: [], locations: profile.places, remote_excluded_regions: [], google_jobs: profile.google},
    preferences: {disqualifying_languages: [], excluded_companies: [], work_rights: profile.work_rights, digest_min_score: 0}, contact: {location: profile.city}};   // digest_min_score 0: every job is shown, so what the digest says about places and visas does not depend on AI scores; the contact details of the first, default-CV setup are replaced by theirs
}

// All the text a person could read in the window: every view, every hidden step, tooltips and placeholders.
const READ_UI = () => {
  const attrs = [...document.querySelectorAll('[placeholder],[title],[aria-label],[alt]')].flatMap(el => [el.getAttribute('placeholder'), el.getAttribute('title'), el.getAttribute('aria-label'), el.getAttribute('alt')]).filter(Boolean);
  return [document.documentElement.textContent, ...attrs].join('\n');
};

export async function run(ctx) {
  const {page, feeds, token: NOTION} = ctx;
  ctx.findings = [];
  await ensureSetUp(ctx);
  for (const key of PERSONAS) {
    const profile = JSON.parse(fs.readFileSync(path.join(personaDir(key), 'profile.json'), 'utf8'));
    const label = `${profile.name}`;
    const read = {ui: '', digest: '', notion: ''};
    await ctx.run(`${label}: starts from nothing: no jobs, runs or employers in Notion, no cached jobs on the Mac, their feeds and CV in place`, async () => {
      await emptyDatabase(NOTION, 'Job Matches — AI Scored'); await emptyDatabase(NOTION, 'Cronjob Runs'); await emptyDatabase(NOTION, 'Employers & Sources');
      for (const file of fs.readdirSync(path.join(personaDir(key), 'feeds'))) fs.copyFileSync(path.join(personaDir(key), 'feeds', file), path.join(feeds, file));
      const data = path.join(ctx.profile, 'data');
      for (const file of fs.existsSync(data) ? fs.readdirSync(data) : []) if (/^jobs\.sqlite/.test(file)) fs.rmSync(path.join(data, file));
      fs.copyFileSync(path.join(personaDir(key), 'cv.pdf'), path.join(ctx.profile, 'cv.pdf'));
      fs.mkdirSync(path.join(ctx.profile, 'config'), {recursive: true});
      fs.copyFileSync(path.join(feeds, 'sources.json'), path.join(ctx.profile, 'config', 'sources.json'));
    }, {needs: ctx.needs});
    await ctx.run(`${label}: their strategy is saved the way the wizard's review saves it, with places, languages and citizenship / work rights`, async () => {
      const saved = await page.evaluate(draft => window.pilot.saveStrategy(draft), draftOf(profile));
      if (saved?.ok === false) throw new Error(`the strategy was not saved: ${saved.error}`);
      await page.reload();
      await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
      const config = path.join(ctx.profile, 'config');
      const search = JSON.parse(fs.readFileSync(path.join(config, 'search.json'), 'utf8'));
      const prefs = JSON.parse(fs.readFileSync(path.join(config, 'preferences.json'), 'utf8'));
      if (JSON.stringify(search.locations) !== JSON.stringify(profile.places)) throw new Error(`the places were not kept: ${JSON.stringify(search.locations)}`);
      if (JSON.stringify(prefs.work_rights) !== JSON.stringify(profile.work_rights)) throw new Error(`citizenship / work rights were not kept: ${JSON.stringify(prefs.work_rights)}`);
      const settingsPage = await pageText(NOTION, 'Search settings');
      if (!/Where you can work without a visa/i.test(settingsPage)) throw new Error('⚙️ Search settings in Notion has no "Where you can work without a visa" section');
      if (!new RegExp(profile.work_rights[0], 'i').test(settingsPage.split(/Where you can work without a visa/i)[1] || '')) throw new Error(`Notion's work-rights section does not list ${profile.work_rights[0]}`);
    }, {needs: ctx.needs});
    await ctx.run(`${label}: a jobs check keeps the roles in their places and drops the wrong ones`, async () => {
      await page.click('.nav[data-view="jobs"]');
      await page.click('#refresh');
      const rolePattern = new RegExp(profile.roles.filter(role => /^[\w ]+$/.test(role)).join('|'), 'i');
      await page.waitForFunction(pattern => (window.__jp.shared.allJobs || []).some(job => new RegExp(pattern, 'i').test(job.title) && job.fit != null && job.fit !== ''),
        rolePattern.source, {timeout: 480000, polling: 3000});
      const titles = await page.evaluate(() => (window.__jp.shared.allJobs || []).map(job => job.title));
      console.log(`  jobs: ${titles.join('; ')}`);
      const wrong = titles.filter(title => /account executive|product designer|intern|sales executive|est[aá]gio/i.test(title));
      if (wrong.length) throw new Error(`jobs for the wrong role were kept: ${wrong.join(', ')}`);
    }, {needs: ctx.needs});
    await ctx.run(`${label}: Find new employers lists the employer in their city and skips the Swiss job boards`, async () => {
      fs.copyFileSync(path.join(feeds, 'scout_seeds.json'), path.join(ctx.profile, 'config', 'scout_seeds.json'));
      await page.click('.nav[data-view="actions"]');
      await page.click('[data-command="scout"]');
      const started = Date.now();
      let listed = null;
      while (!listed && Date.now() - started < 240000) { listed = await findPage(NOTION, 'E2E Gamma').catch(() => null); if (!listed) await page.waitForTimeout(4000); }
      if (!listed) throw new Error('"E2E Gamma" was not listed in Notion (Employers & Sources) within 4 minutes');
      const output = engine(ctx, 'import subprocess, sys; print(subprocess.run([sys.executable, "-m", "src", "discover"], capture_output=True, text=True).stdout)');
      if (!/discovery is skipped/i.test(output)) throw new Error(`jobs.ch/TechTree discovery ran for a user with no Swiss place: ${output.slice(0, 200)}`);
    }, {needs: ctx.needs});
    await ctx.run(`${label}: the digest follows their places, citizenship and the posting's currency`, async () => {
      const result = JSON.parse(engine(ctx, DIGEST_CODE).trim().split('\n').pop());
      read.digest = result.text;
      const problems = [];
      const where = (jobs, needle) => jobs.filter(job => job.location.toLowerCase().includes(needle.toLowerCase()));
      for (const place of profile.expect.noSponsorship) for (const job of where(result.jobs, place)) if (job.sponsorship) problems.push(`flagged "visa sponsorship needed": ${job.title} in ${job.location}, which ${profile.citizenship} citizens need none for`);
      for (const place of profile.expect.sponsorship) {
        const jobs = where(result.jobs, place);
        if (!jobs.length) problems.push(`no job in ${place} reached the digest`);
        for (const job of jobs) if (!job.sponsorship) problems.push(`not flagged "visa sponsorship needed": ${job.title} in ${job.location}`);
      }
      const abroad = result.jobs.filter(job => !job.inPlaces && !/remote/i.test(job.location));
      if (abroad.length && !/Outside your places/.test(result.text)) problems.push('the digest does not say "Outside your places" above jobs elsewhere');
      if (!/your places/i.test(result.text) && abroad.length) problems.push('the digest never says "your places"');
      if (!result.jobs.some(job => job.salary.includes(profile.expect.currency))) problems.push(`no posting's salary was read as "${profile.expect.currency}…" in its own currency: ${JSON.stringify(result.jobs.map(job => job.salary))}`);
      for (const job of result.jobs.filter(job => job.sponsorship)) if (!/visa sponsorship needed/.test(result.text.split(/\n\n(?=\d+\. )/).find(block => block.includes(job.title)) || '')) problems.push(`the digest shows no "visa sponsorship needed" for ${job.title}`);
      if (JSON.stringify(result.google.places) !== JSON.stringify(Object.fromEntries(profile.google.locations.map(place => [place.location, place.language])))) problems.push(`Google Jobs places are ${JSON.stringify(result.google.places)}, not theirs`);
      if (result.google.country !== profile.google.country) problems.push(`Google Jobs country is "${result.google.country}", not "${profile.google.country}"`);
      if (problems.length) throw new Error(problems.join('; '));
    }, {needs: ctx.needs});
    await ctx.run(`${label}: nothing Swiss or EU appears in the UI, the digest or the Notion pages and rows`, async () => {
      const views = ['focus', 'jobs', 'actions', 'interviews', 'settings'];
      const texts = [];
      for (const view of views) {
        await page.click(`.nav[data-view="${view}"]`).catch(() => {});
        await page.waitForTimeout(800);
        texts.push(await page.evaluate(READ_UI));
      }
      // The window says which time zone it shows: this machine's own, whatever it is (a Mac in Zurich is not a hard-coded Zurich).
      read.ui = texts.join('\n').replace(/Times shown in [\w/+-]+\./g, '');
      read.notion = [await databaseText(NOTION, 'Job Matches — AI Scored'), await databaseText(NOTION, 'Job Tracker'), await databaseText(NOTION, 'Employers & Sources'),
        await databaseText(NOTION, 'Cronjob Runs'), await pageText(NOTION, 'Search settings'), await pageText(NOTION, 'Profile — CV and Preferences')].join('\n');
      const config = ['search.json', 'preferences.json'].map(file => fs.readFileSync(path.join(ctx.profile, 'config', file), 'utf8')).join('\n');
      const hits = [];
      for (const [where, text] of Object.entries({'the window': read.ui, 'the digest': read.digest, 'Notion': read.notion, 'the cached settings': config})) {
        const found = [...new Set(text.match(new RegExp(FORBIDDEN.source, 'gi')) || [])];
        if (found.length) hits.push(`${where}: ${found.join(', ')}${(text.match(new RegExp(`.{0,50}(?:${FORBIDDEN.source}).{0,50}`, 'i')) || [''])[0] ? ` (… ${text.match(new RegExp(`.{0,50}(?:${FORBIDDEN.source}).{0,50}`, 'i'))[0].replace(/\s+/g, ' ')} …)` : ''}`);
      }
      if (hits.length) throw new Error(`words from another user's market: ${hits.join(' | ')}`);
      fs.writeFileSync(path.join(ctx.ARTIFACTS, `persona-${key}.txt`), `--- window ---\n${read.ui}\n--- digest ---\n${read.digest}\n--- notion ---\n${read.notion}\n`);
    }, {needs: ctx.needs});
  }
}
