/* global document, window */
// Quality: not whether the Jobs check ran, but whether what it produced is RIGHT. Twelve fictional postings with a known ground truth (fixtures/golden/truth.json)
// go through the real check; the Notion Job Matches rows and the app's own list are then compared with the truth: facts exact, a duplicate collapsed, relevant jobs
// above irrelevant ones, scores in range and stable, every column filled, no programming accident in any text, no job text in the logs. A Sonnet judge reads the
// free text (reason, strengths, gaps) for invented facts. Starts from a set-up install; resets only its own job and run rows.
import {modelClient} from '../lib/model.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sample, watch} from '../lib/activity.mjs';
import {failures, judge} from '../lib/factjudge.mjs';
import {databaseRows, emptyDatabase, profileText, rewriteLines} from '../lib/notion.mjs';
import {checkFacts, dirtyRows, dirtyText, fingerprints, leaks, judgeVerdict, matchRows, missingColumns, normalizeUrl, rankingViolations, stabilityVerdict, unstable} from '../lib/quality.mjs';
import {ensureSetUp} from '../lib/seed.mjs';

export const name = 'quality';
// About $0.3 a run on Sonnet 5.5: the nightly release gate, and a push that touches what it judges (scoring and enrichment prompts, the model ids, its own fixtures), not the three-a-day schedule.
export const cadence = 'nightly';
// It judges the AI's answers (scores, facts), which are the same on every OS: the Mac lane only, no Windows run (owner, 7 Oct 2026: $1.36 a day on Windows).
export const sameOnEveryOs = true;
export const watches = ['src/ai/score.py', 'src/ai/enrich.py', 'src/ai/hints.py', 'desktop/lib/pipeline.js', 'desktop/e2e/fixtures/golden/'];
// This suite measures what a user gets, so the app under test runs on the shipped model (about $0.3 a run); the other suites run on Haiku. For a cheap run:
// E2E_APP_MODEL=claude-haiku-4-5 (Haiku scores the same job up to 10 points apart between two scorings, Sonnet within 6).
export const env = {JOB_PILOTTO_MODEL_OVERRIDE: process.env.E2E_APP_MODEL || 'claude-sonnet-5-5'};
// A persona's Profile is a file the engine reads instead of the test page's Profile (test-only: desktop/lib/pipeline.js JOB_PILOTTO_E2E_PROFILE_FILE).
if (process.env.E2E_QUALITY_PERSONA) env.JOB_PILOTTO_E2E_PROFILE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', `golden-${process.env.E2E_QUALITY_PERSONA}`, 'profile.md');
// E2E_QUALITY_PERSONA=photographer runs the same checks for a fictional commercial photographer in Zurich (fixtures/golden-photographer: her CV, her Profile, 12 postings with a
// known truth, and her CV for the CV-match step), so scoring, ranking, facts and the judge are proven for a profession that is not IT. Default: the SRE.
const PERSONA = process.env.E2E_QUALITY_PERSONA || '';
const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', PERSONA ? `golden-${PERSONA}` : 'golden');
const persona = PERSONA ? JSON.parse(fs.readFileSync(path.join(GOLDEN, 'persona.json'), 'utf8')) : null;
const read = file => JSON.parse(fs.readFileSync(path.join(GOLDEN, file), 'utf8'));
const MATCHES = 'Job Matches — AI Scored';

export async function run(ctx) {
  const {page, token: NOTION} = ctx;
  const truth = process.env.E2E_QUALITY_TRUTH ? JSON.parse(fs.readFileSync(process.env.E2E_QUALITY_TRUTH, 'utf8')) : read('truth.json');   // a different truth: to prove the suite fails
  const candidate = fs.readFileSync(path.join(GOLDEN, 'candidate.txt'), 'utf8');
  const postings = truth.filter(item => !item.duplicateOf);
  const summary = {facts: {exact: 0, total: 0}, ranking: 'not checked', invented: 0, stable: 'not checked'};
  let rows = [], appJobs = [];
  ctx.findings = [];
  await ensureSetUp(ctx);

  const check = async label => {   // one Jobs check; ends when the task is no longer running
    await page.click('.nav[data-view="jobs"]');
    const before = (await sample(page)).newest;
    await page.click('#refresh');
    // The task must show up first: a watcher that looks too early sees "nothing running" and calls the check done.
    const began = Date.now();
    for (;;) {
      const now = await sample(page);
      if (now.running || JSON.stringify(now.newest) !== JSON.stringify(before)) break;
      if (Date.now() - began > 90000) throw new Error(`the ${label} never started: Refresh on the Jobs page started no task within 90 s`);
      await page.waitForTimeout(1500);
    }
    const {samples, endedAt} = await watch(page, {every: 3000, maxMs: 420000});
    const engineLog = path.join(ctx.profile, 'logs', 'engine.log');
    if (fs.existsSync(engineLog)) fs.copyFileSync(engineLog, path.join(ctx.ARTIFACTS, `quality-engine-${label.split(' ')[0]}.log`));
    if (endedAt == null) throw new Error(`the ${label} was still running after 7 minutes`);
    const newest = samples.at(-1).newest;
    if (newest?.ok === false) {
      const log = path.join(ctx.profile, 'logs', 'engine.log');
      if (fs.existsSync(log)) fs.copyFileSync(log, path.join(ctx.ARTIFACTS, 'quality-engine.log'));
      const tail = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').slice(-12).join('\n    ') : '(no engine log)';
      throw new Error(`the ${label} ended as failed: ${newest.result || '(no result text)'}\n  engine log, last lines:\n    ${tail}`);
    }
    await page.waitForTimeout(2000);
  };
  const read2 = async () => {
    const expected = postings.filter(item => !item.filterMayDrop).length;
    for (let waited = 0; waited < 90000; waited += 5000) {   // Notion's query can trail a write by a few seconds: wait for every posting that must be there
      rows = await databaseRows(NOTION, MATCHES);
      if (Object.keys(matchRows(truth, rows).byId).length >= expected) break;
      await page.waitForTimeout(5000);
    }
    appJobs = await page.evaluate(() => (window.__jp.shared.allJobs || []).map(job => ({title: job.title, url: job.url, fit: job.fit, reason: job.reason})));
  };
  const scoresOf = () => Object.fromEntries(Object.entries(matchRows(truth, rows).byId).map(([id, list]) => [id, list[0].props.Score]));

  const late = [];   // the last checks are independent: each one reports, and the suite fails after all of them ran
  const soft = async step => { try { await step(); } catch (error) { late.push(error); } };
  try {
    await ctx.run('this suite starts with no jobs and no runs in its Notion page', async () => {
      await emptyDatabase(NOTION, MATCHES); await emptyDatabase(NOTION, 'Cronjob Runs');
      // The candidate's compensation is known, not whatever the wizard's AI drafted from the CV ("CHF 180,000 (estimate)"): target 170k, minimum 140k.
    if (!persona) {   // a persona states its own compensation in its Profile file
    const set = [await rewriteLines(NOTION, 'Profile — CV and Preferences', /^\s*Target:/, 'Target: CHF 170,000 per year in Switzerland'),
      await rewriteLines(NOTION, 'Profile — CV and Preferences', /^\s*Minimum acceptable:/, 'Minimum acceptable: CHF 140,000 per year in Switzerland')];
    if (set.some(count => count !== 1)) throw new Error(`the Profile page should have one Target line and one Minimum acceptable line, found ${set.join(' and ')}`);
    }
    // The golden postings replace the shared fixture feeds: one board, twelve postings (one is a duplicate).
      for (const file of fs.readdirSync(ctx.feeds)) fs.rmSync(path.join(ctx.feeds, file), {force: true, recursive: true});
      for (const file of ['board.json', 'routes.json']) fs.copyFileSync(path.join(GOLDEN, file), path.join(ctx.feeds, file));
      fs.mkdirSync(path.join(ctx.profile, 'config'), {recursive: true});
      fs.copyFileSync(path.join(GOLDEN, 'sources.json'), path.join(ctx.profile, 'config', 'sources.json'));
      // The search is the candidate's (a senior SRE in Zurich), written here so the roles kept do not depend on what the Notion test page holds.
      const search = JSON.parse(fs.readFileSync(path.join(ctx.E2E, '..', '..', 'config', 'search.json'), 'utf8'));
      fs.writeFileSync(path.join(ctx.profile, 'config', 'search.json'), JSON.stringify({...search,
        role_keywords: ['\\bsre\\b', 'site reliability', 'platform engineer', 'infrastructure engineer', 'devops engineer'],
        locations: {top_tier: ['zurich', 'geneva'], country_wide: ['switzerland', 'basel', 'bern'], abroad: []}, ...(persona?.search || {})}, null, 2));
    }, {needs: ctx.needs});

    await ctx.run('a Jobs check on the golden postings finishes and scores them', async () => { await check('first Jobs check'); await read2(); if (!rows.length) {
        const config = path.join(ctx.profile, 'config');
        throw new Error(`no Job Matches row was in Notion a minute after the check (app's Notion: ${JSON.stringify(await page.evaluate(() => { const n = window.__jp?.shared?.state?.notion; return n && typeof n === 'object' ? Object.fromEntries(Object.entries(n).filter(([, v]) => typeof v === 'string' && /[0-9a-f]{8}-/.test(v)).map(([k, v]) => [k, v.slice(0, 13)])) : String(n); }))}; profile config: ${fs.existsSync(config) ? fs.readdirSync(config).join(', ') : 'none'}; sources.json: ${fs.existsSync(path.join(config, 'sources.json')) ? fs.readFileSync(path.join(config, 'sources.json'), 'utf8').replace(/\s+/g, ' ') : 'missing'}; feed folder: ${fs.readdirSync(ctx.feeds).join(', ')}; search.json: ${fs.readFileSync(path.join(config, 'search.json'), 'utf8').replace(/\s+/g, ' ').slice(0, 700)})`);
      } }, {needs: ctx.needs});

    await ctx.run('every enriched fact equals the ground truth (seniority, work mode, location, languages, salary, role family)', async () => {
      const {byId} = matchRows(truth, rows);
      const problems = [];
      for (const item of postings) {
        const found = byId[item.id];
        if (!found) { if (!item.filterMayDrop) problems.push(`"${item.title}" is missing from Notion`); continue; }
        for (const result of checkFacts(item, found[0])) {
          summary.facts.total++;
          if (result.ok) summary.facts.exact++; else problems.push(`"${result.posting}": ${result.fact} should be ${JSON.stringify(result.expected)}, the app wrote ${JSON.stringify(result.actual)}`);
        }
      }
      console.log(`  ${summary.facts.exact}/${summary.facts.total} facts exact`);
      if (problems.length) throw new Error(`${problems.length} wrong or missing fact(s):\n    ${problems.join('\n    ')}`);
    }, {needs: ctx.needs});

    await ctx.run('the duplicate posting is one job, everywhere', async () => {
      const urls = rows.map(row => normalizeUrl(row.props['Job URL']));
      const copies = [...new Set(urls.filter((url, i) => urls.indexOf(url) !== i))];
      const titles = rows.map(row => `${row.props.Job}|${row.props.Location}`);
      const sameTitle = [...new Set(titles.filter((title, i) => titles.indexOf(title) !== i))];
      const inApp = appJobs.map(job => normalizeUrl(job.url)).filter(url => url.startsWith('https://boards.e2e.test/')), appCopies = [...new Set(inApp.filter((url, i) => inApp.indexOf(url) !== i))];
      const {strays} = matchRows(truth, rows);
      const problems = [...copies.map(url => `Notion has two rows for ${url}`), ...sameTitle.map(title => `Notion lists "${title}" twice`),
        ...appCopies.map(url => `the app's list shows ${url} twice`), ...strays.map(row => `a row no posting explains: ${row.props.Job} (${row.props['Job URL']})`)];
      if (problems.length) throw new Error(problems.join('; '));
    }, {needs: ctx.needs});

    await ctx.run('relevant jobs rank above irrelevant ones, and scores are whole numbers from 0 to 100', async () => {
      const scores = scoresOf();
      const outside = rows.filter(row => !(Number.isInteger(row.props.Score) && row.props.Score >= 0 && row.props.Score <= 100));
      if (outside.length) throw new Error(`a score is not a whole number from 0 to 100: ${outside.map(row => `${row.props.Job} = ${row.props.Score}`).join(', ')}`);
      const high = postings.filter(item => item.fit === 'high');
      const missing = high.filter(item => scores[item.id] == null);
      if (missing.length) throw new Error(`relevant job(s) were not scored: ${missing.map(item => item.title).join(', ')}`);
      const violations = rankingViolations(truth, scores);
      summary.ranking = violations.length ? `${violations.length} violation(s)` : 'ok';
      console.log(`  scores: ${postings.map(item => `${item.id}=${scores[item.id] ?? 'dropped'}`).join(' ')}`);
      if (violations.length) throw new Error(violations.map(v => `"${v.low}" (${v.lowScore}) is not below "${v.high}" (${v.highScore})`).join('; '));
    }, {needs: ctx.needs});

    await ctx.run('every Notion column the app promises is filled, and no text shows a programming accident', async () => {
      const problems = [];
      for (const row of rows) { const item = matchRows(truth, [row]).byId; const posting = truth.find(entry => item[entry.id]); const missing = missingColumns(row, posting?.mayBeEmpty); if (missing.length) problems.push(`${row.props.Job}: empty ${missing.join(', ')}`); }
      for (const dirty of dirtyRows(rows)) problems.push(`${dirty.where} shows ${dirty.problems.join(', ')}`);
      // What a person reads: the Jobs page and the app's own list.
      const visible = await page.evaluate(() => document.querySelector('.view[data-view="jobs"]')?.innerText || '');
      for (const found of dirtyText(visible)) problems.push(`the Jobs page shows ${found}`);
      for (const job of appJobs) for (const found of dirtyText(`${job.title} ${job.reason}`)) problems.push(`the app's list shows ${found} for "${job.title}"`);
      if (problems.length) throw new Error(problems.join('; '));
    }, {needs: ctx.needs});

    await ctx.run('the app\'s list agrees with Notion (same jobs, same scores)', async () => {
      const problems = [];
      for (const row of rows) {
        const job = appJobs.find(item => normalizeUrl(item.url) === normalizeUrl(row.props['Job URL']));
        if (!job) problems.push(`"${row.props.Job}" is in Notion but not in the app's list`);
        else if (Number(job.fit) !== row.props.Score) problems.push(`"${row.props.Job}": Notion says ${row.props.Score}, the app shows ${job.fit}`);
      }
      if (problems.length) throw new Error(problems.join('; '));
    }, {needs: ctx.needs});

    await soft(() => ctx.run('scoring the same jobs again gives the same scores (within 8 points)', async () => {
      const first = scoresOf();
      // Ask for every score again, the way "Re-score" does (an empty input hash: no shortcut), then run the check once more.
      const database = path.join(ctx.profile, 'data', 'jobs.sqlite');
      if (!fs.existsSync(database)) throw new Error(`the jobs database is not where expected: ${database}`);
      execFileSync('python3', ['-c', 'import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute("UPDATE scores SET input_hash=\'\'"); db.commit()', database]);
      await check('second Jobs check');
      await read2();
      const second = scoresOf();
      const spread = Object.keys(first).filter(id => second[id] != null).map(id => Math.abs(first[id] - second[id]));
      summary.stable = `within ±${Math.max(0, ...spread)}`;
      console.log(`  second scores: ${postings.map(item => `${item.id}=${second[item.id] ?? '-'}`).join(' ')}`);
      if (!spread.length) throw new Error('the second check scored nothing to compare');
      const apart = unstable(first, second, 8), verdict = stabilityVerdict(apart, spread.length);
    if (apart.length) console.log(`  ${apart.length} of ${spread.length} jobs moved more than 8 points (allowed: ${verdict.allowed}): ${apart.map(item => `${item.id}: ${item.first} → ${item.second}`).join(', ')}`);
    if (!verdict.ok) throw new Error(`scores are not stable: ${verdict.problems.join('; ')}`);
    }, {needs: ctx.needs}));

    await soft(() => ctx.run('no job text, CV text or secret reached the logs', async () => {
      const logs = path.join(ctx.profile, 'logs');
      const text = fs.existsSync(logs) ? fs.readdirSync(logs).filter(file => file.endsWith('.log')).map(file => fs.readFileSync(path.join(logs, file), 'utf8')).join('\n') : '';
      if (text.length < 200) throw new Error('the logs are empty: there is nothing to check');
      const needles = [...postings.flatMap(item => fingerprints(item.description)), ...fingerprints(candidate), persona?.email || 'alex.example@example.test', ctx.appKey, ctx.token];
      const found = leaks(text, needles.filter(Boolean));
      if (found.length) throw new Error(`${found.length} piece(s) of private data are in the logs: ${found.map(needle => needle === ctx.appKey || needle === ctx.token ? '(a secret)' : `"${needle.slice(0, 40)}"`).join(', ')}`);
    }, {needs: ctx.needs}));

    await soft(() => ctx.run('the score reasons say nothing invented or untrue (Sonnet judge)', async () => {
      const {byId} = matchRows(truth, rows);
      // The candidate as the app knows them: the CV text plus the Profile page the scoring read (figures such as a salary minimum may come from there).
      const profile = `${candidate}\n\nPROFILE PAGE IN NOTION\n${persona ? fs.readFileSync(path.join(GOLDEN, 'profile.md'), 'utf8') : await profileText(NOTION, 'Profile — CV and Preferences').catch(() => '')}`.slice(0, 30000);
      const verdicts = [], problems = [];
      const todo = postings.filter(item => byId[item.id]);
      for (let i = 0; i < todo.length; i += 4) {
        await Promise.all(todo.slice(i, i + 4).map(async item => {
          const p = byId[item.id][0].props;
          const produced = [p.Reason, p.Strengths && `Strengths: ${p.Strengths}`, p.Gaps && `Gaps: ${p.Gaps}`];
          const facts = Object.fromEntries(['Seniority', 'Work mode', 'Languages', 'Salary', 'Role family', 'Technologies', 'Recruiter'].map(column => [column, p[column]]));
          // The employer is on every posting the app read (fixtures/golden/sources.json): without it the judge called the company's own name invented (Windows run 37150232804, job 3008).
          const verdict = await judge({key: ctx.key, posting: {...item, company: item.company || read('sources.json')[0].company}, profile, produced, facts});
          verdicts.push({id: item.id, title: item.title, produced, verdict});
          const bad = failures(verdict);
          if (bad.length) problems.push(`"${item.title}" ${bad.join(' and ')}: ${verdict.why} [text: ${produced.filter(Boolean).join(' / ')}]`);
        }));
      }
      summary.invented = verdicts.filter(v => v.verdict.invents_facts).length;
      fs.writeFileSync(path.join(ctx.ARTIFACTS, 'quality-verdicts.json'), JSON.stringify(verdicts, null, 2));
      console.log(`  judged ${verdicts.length} score texts: ${verdicts.filter(v => v.verdict.grounded).length} grounded, ${verdicts.filter(v => v.verdict.useful).length} useful, ${summary.invented} with invented facts`);
    const allowance = judgeVerdict(problems, verdicts.length);
    if (problems.length) console.log(`  ${problems.length} of ${verdicts.length} texts flagged (allowed: ${allowance.allowed}):\n    ${problems.join('\n    ')}`);
    if (!allowance.ok) throw new Error(`${problems.length} of ${verdicts.length} score texts invent facts or contradict the posting (at most ${allowance.allowed} allowed)`);
    }, {needs: ctx.needs}));

    // The CV match (desktop/lib/match-check.js) on three golden postings with a fixed CV, judged by plain text rules, no second model: the terms the posting and the CV
    // both state must come back as found, and the code has to correct the model's claims about the CV only rarely (it corrects them; this watches how often).
    await soft(() => ctx.run('the CV match is right about the CV on golden postings: required terms found, few claims corrected', async () => {
      process.env.JOB_PILOTTO_MODEL_OVERRIDE ||= env.JOB_PILOTTO_MODEL_OVERRIDE;
      const {check, cvText} = await import('../../lib/match-check.js');
      const cv = persona?.cvMatch?.cv ?? {summary: 'Senior Site Reliability Engineer, nine years in cloud infrastructure, Kubernetes, observability and incident response.', skills: 'Kubernetes, Terraform, AWS, Datadog, OpenTelemetry, SLOs',
        jobs: [{company: 'Acme Cloud', roles: [{title: 'Senior SRE', period: '2022 – Present', place: 'Zurich', skills: 'AWS EKS, Terraform, Datadog',
          bullets: ['Ran 400 microservices on Kubernetes (AWS EKS)', 'Cut incident time by 40 percent with Datadog and OpenTelemetry', 'Built the Terraform platform used by 120 engineers', 'Led the on-call rotation of 8 people']}]},
          {company: 'Beta Systems', roles: [{title: 'Platform Engineer', period: '2018 – 2022', place: 'Berlin', bullets: ['Migrated 60 services to Kubernetes', 'Introduced SLOs and error budgets']}]}]};
      const text = cvText(cv).toLowerCase();
      const TERMS = persona?.cvMatch?.terms ?? ['kubernetes', 'terraform', 'aws', 'datadog', 'opentelemetry', 'slos'];
      let expected = 0, got = 0, corrected = 0;
      for (const item of postings.filter(entry => entry.fit === 'high').slice(0, 3)) {
        const result = await check({}, ctx.key, {job: item, cv, client: modelClient({key: ctx.key})});   // through lib/model.mjs either way: Claude Code on a Mac, the API in CI (counted for /ai-cost)
        corrected += result.corrected;
        for (const term of TERMS.filter(candidateTerm => text.includes(candidateTerm) && item.description.toLowerCase().includes(candidateTerm))) {
          expected++;
          if (result.musts.some(must => must.term.toLowerCase().includes(term) && must.status === 'found')) got++;
        }
        // The product's rule (match-check.js guard): "found" needs the term OR the model's quoted evidence in the CV ("Kubernetes on AWS", evidence "Kubernetes (AWS EKS)": run 37136327455).
        const words = value => ` ${String(value || '').toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu, ' ').replace(/\s+/g, ' ').trim()} `;
        const stated = phrase => words(phrase).trim().length >= 2 && words(text).includes(words(phrase));
        for (const must of result.musts) if (must.status === 'found' && !stated(must.term) && !stated(must.evidence)) throw new Error(`"${item.title}": "${must.term}" is marked found, but the CV states neither it nor its evidence ("${must.evidence || ''}")`);
      }
      console.log(`  CV match: ${got}/${expected} required terms found, ${corrected} claim(s) corrected by the guard`);
      if (expected && got / expected < 0.7) throw new Error(`only ${got} of ${expected} terms that the posting and the CV both state came back as found`);
      if (corrected > 4) throw new Error(`the guard had to correct ${corrected} claims about the CV on three postings (at most 4)`);
    }, {needs: ctx.needs}));

    if (late.length) throw new Error(`${late.length} quality check(s) failed: ${late.map(error => error.message.split('\n')[0].slice(0, 120)).join(' | ')}`);
  } finally {   // the one-line summary is printed whatever failed
    const line = `quality: ${summary.facts.exact}/${summary.facts.total} facts exact, ranking ${summary.ranking}, ${summary.invented} invented facts, scores stable ${summary.stable}`;
    console.log(`\n${line}\n`);
    fs.writeFileSync(path.join(ctx.ARTIFACTS, 'quality-summary.txt'), line + '\n');
  }
}
