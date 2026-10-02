/* global document, window, chrome */
// Apply with the real Chrome extension on fixture forms: the app's Apply click opens a form, the extension fills it from the job's kit, leaves what is the
// person's to decide, and never submits. Starts from a set-up install; writes and removes only its own jobs in its Notion page. The forms are local
// (lib/forms.mjs, behind the real job-site host names), the AI answer is canned, so the suite costs nothing and no employer site is contacted.
import fs from 'node:fs';
import path from 'node:path';
import {cvProblems, fillProblems, highlightProblems, leftProblems, submitProblems} from '../lib/applycheck.mjs';
import {CHAIN, FORMS, HOSTS} from '../lib/forms.mjs';
import {launchBrowser, readForm, readPanel, fillState} from '../lib/extension.mjs';
import {addKitJob, removeJobsByUrl} from '../lib/notion.mjs';
import {ensureSetUp} from '../lib/seed.mjs';

export const minutes = 12;
export const browser = true;
export const name = 'apply';

// The applicant whose details the app hands the extension (written to this suite's own Notion Profile, never a real person).
const CONTACT = {first_name: 'Ada', last_name: 'Tester', full_name: 'Ada Tester', email: 'ada.tester@example.test', phone: '+41 79 555 01 23', location: 'Zurich, Switzerland', linkedin: 'https://www.linkedin.com/in/ada-tester'};
const OPEN_ANSWER = 'Because the platform work here is about reliability at scale, which is what I have done for eight years.';

const expectedOf = form => Object.fromEntries(form.kit.filter(item => !form.legal.includes(item.field)).map(item => [item.field, item.answer]));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function run(ctx) {
  const {page, token: NOTION, proxy, forms} = ctx;
  ctx.findings = [];
  await ensureSetUp(ctx);
  const urls = [...Object.values(FORMS).map(form => form.url), CHAIN.url];
  const cv = {name: 'cv.pdf', size: fs.statSync(path.join(ctx.profile, 'cv.pdf')).size};

  await ctx.run('the app has an applicant, four jobs with drafted kits, and an AI that answers only what the kits do not', async () => {
    await page.evaluate(contact => window.pilot.saveContact(contact), CONTACT);
    console.log(`  removed ${await removeJobsByUrl(NOTION, urls)} job row(s) left by an earlier run`);
    for (const form of [...Object.values(FORMS), CHAIN]) await addKitJob(NOTION, {title: form.title, company: form.company, url: form.url, kit: {answers: form.kit, cover_letter: '', check_before_sending: []}});
    // The app's own AI calls go to the test proxy: the one question no kit covers gets a fixed answer, everything else would pass through (and is counted).
    proxy.setCanned(body => {
      const content = body.messages?.[0]?.content;
      const asked = /<form_fields>\n([\s\S]*?)\n<\/form_fields>/.exec(typeof content === 'string' ? content : (content || []).map(part => part.text || '').join(''));
      if (!asked) return null;
      const answers = JSON.parse(asked[1]).filter(item => item.field === 'why').map(item => ({field: item.field, value: OPEN_ANSWER, confidence: 'medium', note: 'inferred from the profile'}));
      return JSON.stringify({eligible: true, eligibility_note: '', answers});
    });
    await page.reload();
    await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    await page.click('.nav[data-view="jobs"]');
    await page.waitForFunction(wanted => wanted.every(url => (window.__jp.shared.allJobs || []).some(job => job.url === url && job.kit)), urls, {timeout: 120000, polling: 2000})
      .catch(async () => {
        const seen = await page.evaluate(() => (window.__jp.shared.allJobs || []).map(job => `${job.company} [${job.stage}${job.kit ? ', kit' : ''}]`));
        throw new Error(`the Jobs list never showed the four kit jobs with an Apply button; it holds ${seen.length}: ${seen.join('; ')}`);
      });
    ctx.browser = await launchBrowser({port: forms.port, spool: ctx.shim.spool, extensionDir: ctx.extensionDir});
    await ctx.browser.serviceWorker();
  }, {needs: ctx.needs});

  // The person's click on a job's Apply button; the form opens in the browser with the extension, which fills it by itself. -> the tab, once the fill is over.
  async function apply(form) {
    const opened = ctx.browser.opened.length;
    await page.click('.nav[data-view="jobs"]');
    await page.locator('article.job-row').filter({hasText: form.company}).first().locator('.row-main').click();
    const deadline = Date.now() + 30000;
    while (ctx.browser.opened.length === opened && Date.now() < deadline) await pause(250);
    if (ctx.browser.opened.length === opened) throw new Error(`Apply did not open ${form.title} in the browser (the app's open command was never called)`);
    const url = ctx.browser.opened.at(-1);
    if (!url.endsWith('#jobpilotto-fill')) throw new Error(`Apply opened ${url} without the fill marker the extension looks for`);
    const tab = ctx.browser.pages[url.split('#')[0]];
    for (let waited = 0; waited < 90000; waited += 500) {
      const state = await fillState(tab).catch(() => null);
      if (state?.state === 'done' || state?.state === 'error') return {tab, state};
      await pause(500);
    }
    throw new Error(`the extension never finished filling ${form.title} (state: ${JSON.stringify(await fillState(tab).catch(() => null))})`);
  }
  // The panel opens by itself while a fill runs; open it only when it is closed (a click on the pill toggles).
  const panelOf = async tab => {
    const closed = await tab.evaluate(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.card')?.hidden);
    if (closed) await tab.locator('#jobpilotto-review-host .pill').click({timeout: 15000});
    await pause(1500);
    return readPanel(tab);
  };
  let unknownTab = null;
  const fail = problems => { if (problems.length) throw new Error(problems.join('; ')); };

  await ctx.run('a Greenhouse-like form: every kit answer and your details are filled, the CV is attached, the legal box is left, Submit untouched', async () => {
    const form = FORMS.greenhouse;
    const {tab, state} = await apply(form);
    if (state.state === 'error') throw new Error(`the fill ended in an error: ${state.error}`);
    const actual = await readForm(tab);
    fail([...fillProblems({expected: {...expectedOf(form), first_name: CONTACT.first_name, last_name: CONTACT.last_name, email: CONTACT.email, phone: CONTACT.phone}, left: form.legal, actual}),
      ...cvProblems(actual, cv),
      // A long drafted answer is flagged for a read-through; a short fact or your own details are not.
      ...highlightProblems({actual, ai: ['question_1004'], plain: ['question_1001', 'question_1003', 'first_name', 'email']}),
      ...submitProblems(forms.fired, form.path)]);
    const panel = await panelOf(tab);
    if (!panel) throw new Error('no Job Pilotto panel on the form');
    console.log(`  panel: "${panel.progress}"; left for you: ${panel.left.join(' | ') || 'nothing'}`);
    fail(leftProblems(panel.left, ['privacy']));
  }, {needs: ctx.needs});

  await ctx.run('a Lever-like form: a field rendered late is filled, the question no kit covers is answered by the AI and highlighted', async () => {
    const form = FORMS.lever;
    const callsBefore = proxy.stats.canned;
    const {tab, state} = await apply(form);
    if (state.state === 'error') throw new Error(`the fill ended in an error: ${state.error}`);
    const actual = await readForm(tab);
    fail([...fillProblems({expected: {...expectedOf(form), name: CONTACT.full_name, email: CONTACT.email, why: OPEN_ANSWER}, actual}), ...cvProblems(actual, cv),
      ...highlightProblems({actual, ai: ['why'], plain: ['org', 'heard', 'email']}), ...submitProblems(forms.fired, form.path)]);
    if (proxy.stats.canned - callsBefore < 1) throw new Error('the AI was never asked about the open question');
  }, {needs: ctx.needs});

  await ctx.run('a multi-step form: step 1 is filled, step 2 only once you reach it, the consent is left to you, Submit untouched', async () => {
    const form = FORMS.multistep;
    const {tab, state} = await apply(form);
    if (state.state === 'error') throw new Error(`the fill ended in an error: ${state.error}`);
    let actual = await readForm(tab);
    fail([...fillProblems({expected: {first_name: CONTACT.first_name, last_name: CONTACT.last_name, email: CONTACT.email}, actual}), ...cvProblems(actual, cv),
      ...(actual.salary.value ? ['salary: the step the person has not reached was filled'] : [])]);
    await tab.click('#next_step');   // the person goes on to step 2 (never Submit)
    const panel = await panelOf(tab);
    if (!panel) throw new Error('no Job Pilotto panel on the form');
    await tab.locator('#jobpilotto-review-host .fill').click({timeout: 15000});
    await tab.waitForFunction(() => document.getElementById('salary')?.value, null, {timeout: 60000}).catch(() => { throw new Error('"Fill again" did not fill step 2 (salary stayed empty)'); });
    actual = await readForm(tab);
    fail([...fillProblems({expected: expectedOf(form), left: form.legal, actual}), ...submitProblems(forms.fired, form.path)]);
    fail(leftProblems((await readPanel(tab)).left, ['personal data']));
  }, {needs: ctx.needs});

  await ctx.run('a form with a control the extension cannot operate: the miss is reported to the app', async () => {
    const form = FORMS.unknown;
    const {tab, state} = await apply(form);
    if (state.state === 'error') throw new Error(`the fill ended in an error: ${state.error}`);
    const actual = await readForm(tab);
    fail([...fillProblems({expected: {...expectedOf(form), first_name: CONTACT.first_name, email: CONTACT.email}, actual}), ...submitProblems(forms.fired, form.path)]);
    // Reported to the app: it keeps the control's shape in misses.json and says so in its log.
    const file = path.join(ctx.profile, 'misses.json');
    let kept = [];
    for (let waited = 0; waited < 30000 && !kept.some(entry => entry.kind === 'slider'); waited += 1000) {
      kept = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
      await pause(1000);
    }
    if (!kept.some(entry => entry.kind === 'slider')) throw new Error('the app was never told about the slider (no "slider" entry in misses.json)');
    const log = fs.readFileSync(path.join(ctx.profile, 'logs', 'app.log'), 'utf8');
    if (!/\[misses\] \d+ new control/.test(log)) throw new Error('the app kept the miss but did not log it');
    unknownTab = tab;
  }, {needs: ctx.needs});

  // Found by asking "can the extension follow a journey from one tab to another?" (3 Oct 2026): a posting whose Apply opens a NEW tab, whose page has only a
  // "To apply" link, and only then the form (jobs.ch -> an agency's own site). The extension must press Apply, follow the new tab as the same application, press
  // "To apply" in it, and fill the form it reaches; Submit untouched.
  await ctx.run('a posting whose Apply opens a new tab, then a "To apply" step, then the form: the journey is followed and the form filled', async () => {
    const opened = ctx.browser.opened.length;
    await page.click('.nav[data-view="jobs"]');
    await page.locator('article.job-row').filter({hasText: CHAIN.company}).first().locator('.row-main').click();
    for (let waited = 0; ctx.browser.opened.length === opened && waited < 30000; waited += 250) await pause(250);
    if (ctx.browser.opened.length === opened) throw new Error('Apply did not open the posting in the browser');
    const seen = [];
    let tab = null;
    for (let waited = 0; waited < 90000 && !tab; waited += 1000) {
      const pages = ctx.browser.context.pages();
      seen.splice(0, seen.length, ...pages.map(item => item.url().split('#')[0]));
      tab = pages.find(item => item.url().startsWith(CHAIN.formUrl)) || null;
      await pause(1000);
    }
    if (!tab) {
      // What the extension itself holds: which tabs it armed, whose job each follows, and who opened whom (the cause is in here, not in the page).
      const inside = await (await ctx.browser.serviceWorker()).evaluate(async () => ({session: await chrome.storage.session.get(null),
        tabs: (await chrome.tabs.query({})).map(item => ({id: item.id, opener: item.openerTabId ?? null, url: String(item.url).split('#')[0].slice(0, 70)}))})).catch(error => ({error: String(error)}));
      console.log(`  extension state at the failure: ${JSON.stringify(inside)}`);
    }
    if (!tab) throw new Error(`the journey never reached the form. Tabs open: ${seen.join(' | ')}. ${seen.some(url => url.startsWith(CHAIN.stepUrl)) ? 'The new tab opened but "To apply" was not followed.' : 'Apply did not open the second tab.'}`);
    let state = null;
    for (let waited = 0; waited < 90000; waited += 500) {
      state = await fillState(tab).catch(() => null);
      if (state?.state === 'done' || state?.state === 'error') break;
      await pause(500);
    }
    if (state?.state !== 'done') throw new Error(`the form was reached but not filled (state: ${JSON.stringify(state)})`);
    const actual = await readForm(tab);
    fail([...fillProblems({expected: {first_name: CONTACT.first_name, last_name: CONTACT.last_name, email: CONTACT.email, question_3001: '7'}, actual}), ...cvProblems(actual, cv),
      ...submitProblems(forms.fired, CHAIN.path), ...submitProblems(forms.fired, CHAIN.formPath)]);
    // The panel offers "Take over with Claude" on this tab (the person's click starts a Claude session: not pressed here, a test must never launch one).
    const offered = await tab.evaluate(() => { const button = document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.take-over'); return !!button && !button.hidden && /take over with claude/i.test(button.textContent); });
    if (!offered) throw new Error('the panel does not offer "Take over with Claude" on an armed form tab');
  }, {needs: ctx.needs});

  await ctx.run('through all of it: Submit was never clicked or submitted, and no host but the fixture job sites was contacted', async () => {
    fail(submitProblems(forms.fired, ''));
    const strange = [...ctx.browser.requested].filter(host => !HOSTS.includes(host) && host !== '127.0.0.1' && host !== 'localhost' && host !== '');
    if (strange.length) throw new Error(`the browser asked for hosts outside the fixtures: ${strange.join(', ')}`);
    await removeJobsByUrl(NOTION, urls);
  }, {needs: ctx.needs});

  // Found by this suite (2 Oct 2026): extension/review.js built the panel's list from native fields only, so a REQUIRED custom widget it cannot read (here a
  // role=slider) was in no list and no count, and the panel said "Ready to submit, every required field is filled" over a form that still needed an answer.
  // The miss was reported to the app but not shown to the person. Fixed in review.js; this step keeps it fixed (worker/test/panel-widgets.test.js is the unit test).
  await ctx.run('the panel does not say "Ready to submit" over a required control it could not fill, and lists the question', async () => {
    const panel = await panelOf(unknownTab);
    console.log(`  panel: "${panel?.progress}"; left for you: ${panel?.left.join(' | ') || 'nothing'}; pill: "${panel?.pill}"`);
    if (/ready to submit/i.test(`${panel?.pill} ${panel?.progress}`)) throw new Error('the panel says "Ready to submit" while the required "How would you rate your Terraform skill?" control is unanswered');
    fail(leftProblems(panel?.left || [], ['Terraform skill']));
  }, {needs: ctx.needs});
}
