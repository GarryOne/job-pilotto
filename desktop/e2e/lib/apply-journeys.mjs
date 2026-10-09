/* global document, window */
// The apply suite's journey steps (moved out of suites/apply.mjs, 8 Oct 2026): a posting that opens a tab, side-by-side applications, sign-up, one page, a closed form tab, a wrong page kind. Guards the flows in docs/flows/applying.md.
import {CHAIN, LATE, MISLABELLED, ONEPAGE, SCRIPTED, SIGNIN, SIGNIN_PASSWORD, SIGNIN_REFUSED, SIGNUP} from './forms.mjs';
import {CONTACT, pause} from './apply-fixtures.mjs';
import {appLogText} from './app-log.mjs';
import {cvProblems, fillProblems, submitProblems} from './applycheck.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fillState, launchBrowser, readForm} from './extension.mjs';

export async function runJourneys(ctx, h) {
  const {cv, dumpExtension, fail, forms, page} = h;
  // Found by asking "can the extension follow a journey from one tab to another?" (3 Oct 2026): a posting whose Apply opens a NEW tab (since 8 Oct 2026
  // loaded in the posting's own tab instead, extension/same-tab.js), whose page has only a
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
    if (!tab) await dumpExtension();
    if (!tab) throw new Error(`the journey never reached the form. Tabs open: ${seen.join(' | ')}. ${seen.some(url => url.startsWith(CHAIN.stepUrl)) ? 'The new tab opened but "To apply" was not followed.' : 'Apply did not open the second tab.'}`);
    // The form page answers only to the step's POST: "session expired" means the posted data was dropped (the address loaded again).
    for (let waited = 0; waited < 10000 && !(await tab.locator('#application_form, form input').count().catch(() => 0)); waited += 500) await pause(500);
    if (await tab.locator('#expired').count().catch(() => 0)) throw new Error('"To apply" posts its form into a new tab, and the form page said "session expired": the posted data was lost on the way to one tab');
    // One tab for the whole journey (owner, 8 Oct 2026): the page Apply opened in a new tab loads in the posting's own tab, and the new tab closes.
    const journey = ctx.browser.context.pages().filter(item => [CHAIN.url, CHAIN.stepUrl, CHAIN.formUrl].some(url => item.url().startsWith(url.split('#')[0])));
    if (journey.length !== 1) throw new Error(`the journey was in ${journey.length} tabs, not one: ${journey.map(item => item.url().split('#')[0]).join(' | ')}`);
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
    // Floating labels: a filled field was left like a person leaves it (focus, then blur), so the site moved its label out of the way.
    const stuckLabels = await tab.evaluate(() => ['first_name', 'last_name', 'email', 'question_3001'].filter(id => !document.querySelector(`label[for=${id}]`)?.classList.contains('up')));
    if (stuckLabels.length) throw new Error(`filled, but the site never saw the field being left (its floating label stayed over the value): ${stuckLabels.join(', ')}`);
    // The panel offers "Take over with Claude" on this tab (the person's click starts a Claude session: not pressed here, a test must never launch one).
    const offered = await tab.evaluate(() => { const button = document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.take-over'); return !!button && !button.hidden && /take over with claude/i.test(button.textContent); });
    if (!offered) throw new Error('the panel does not offer "Take over with Claude" on an armed form tab');
  }, {needs: ctx.needs});

  // Two applications side by side (8 Oct 2026: Coop and Manor started seconds apart; Migros's sign-in page showed on Manor's card). SCRIPTED's Apply opens its
  // form from the page's own script (nothing to point at the same tab: the new tab is followed, the posting closes); CHAIN's goes link → posted form. Started
  // 2 s apart, each ends in one tab, filled from its OWN kit (9 vs 7: a form credited to the other job shows the wrong number).
  await ctx.run('two applications side by side, one whose Apply opens its form from script: each keeps one tab and its own kit', async () => {
    for (const item of ctx.browser.context.pages()) if ([CHAIN.url, CHAIN.stepUrl, CHAIN.formUrl, SCRIPTED.url, SCRIPTED.formUrl].some(url => item.url().startsWith(url))) await item.close();   // an earlier step's tabs
    // Apply's own call (the row's button, which on a job already applying in an earlier step only opens its session): both start here.
    const apply = job => page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [job.url, {title: job.title, company: job.company}]);
    await apply(SCRIPTED);
    await pause(2000);
    await apply(CHAIN);
    const find = url => ctx.browser.context.pages().find(item => item.url().startsWith(url)) || null;
    let scripted = null, chain = null;
    for (let waited = 0; waited < 90000 && !(scripted && chain); waited += 1000) { scripted = find(SCRIPTED.formUrl); chain = find(CHAIN.formUrl); await pause(1000); }
    const seen = () => ctx.browser.context.pages().map(item => item.url().split('#')[0]).join(' | ');
    if (!scripted || !chain) { await dumpExtension(); throw new Error(`not both forms were reached (scripted: ${!!scripted}, chain: ${!!chain}). Tabs open: ${seen()}`); }
    const tabsOf = urls => ctx.browser.context.pages().filter(item => urls.some(url => item.url().startsWith(url))).length;
    for (let waited = 0; waited < 10000 && tabsOf([SCRIPTED.url, SCRIPTED.formUrl]) > 1; waited += 500) await pause(500);   // the posting closes once its new tab is followed
    const problems = [];
    if (tabsOf([SCRIPTED.url, SCRIPTED.formUrl]) !== 1) problems.push(`the scripted application is in ${tabsOf([SCRIPTED.url, SCRIPTED.formUrl])} tabs, not one: ${seen()}`);
    if (tabsOf([CHAIN.url, CHAIN.stepUrl, CHAIN.formUrl]) !== 1) problems.push(`the chain application is in ${tabsOf([CHAIN.url, CHAIN.stepUrl, CHAIN.formUrl])} tabs, not one: ${seen()}`);
    for (const [tab, job, answer] of [[scripted, SCRIPTED, '9'], [chain, CHAIN, '7']]) {
      let state = null;
      for (let waited = 0; waited < 90000; waited += 500) { state = await fillState(tab).catch(() => null); if (state?.state === 'done' || state?.state === 'error') break; await pause(500); }
      if (state?.state !== 'done') { problems.push(`${job.company}: its form was reached but not filled (state: ${JSON.stringify(state)})`); continue; }
      const read = (await readForm(tab)).question_3001, value = String(read?.value ?? read ?? "");
      if (value !== answer) problems.push(`${job.company}: Kubernetes years "${value}", its own kit says ${answer}${value === (answer === '9' ? '7' : '9') ? ' (the other job\'s kit)' : ''}`);
    }
    fail(problems);
  }, {needs: ctx.needs});

  // A form drawn late (9 Oct 2026, SuccessFactors after a sign-in): judged while empty it reads as a posting whose "Apply" is the form's own submit span.
  // That is never pressed; once the fields come the page is looked at again (fill-flow.js watchForFields) and filled, with the panel on it.
  await ctx.run('a form drawn after a spinner: its submit is never pressed as Apply, and it is filled once its fields come', async () => {
    for (const item of ctx.browser.context.pages()) if ([LATE.url, LATE.formUrl].some(url => item.url().startsWith(url))) await item.close();
    await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [LATE.url, {title: LATE.title, company: LATE.company}]);
    let tab = null;
    for (let waited = 0; waited < 60000 && !tab; waited += 1000) { tab = ctx.browser.context.pages().find(item => item.url().startsWith(LATE.formUrl)) || null; await pause(1000); }
    if (!tab) { await dumpExtension(); throw new Error(`the late form was never reached. Tabs: ${ctx.browser.context.pages().map(item => item.url()).join(' | ')}`); }
    let state = null;
    for (let waited = 0; waited < 90000; waited += 500) { state = await fillState(tab).catch(() => null); if (state?.state === 'done' || state?.state === 'error') break; await pause(500); }
    const problems = [...submitProblems(forms.fired, LATE.formPath)];
    if (state?.state !== 'done') problems.push(`the form was not filled once its fields came (state: ${JSON.stringify(state)})`);
    else {
      const read = (await readForm(tab)).question_3001, value = String(read?.value ?? read ?? '');
      if (value !== '5') problems.push(`Kubernetes years "${value}", the kit says 5`);
    }
    if (!(await tab.evaluate(() => !!document.getElementById('jobpilotto-review-host')).catch(() => false))) problems.push('no panel on the form once its fields came');
    if (problems.length) await dumpExtension();
    fail(problems);
  }, {needs: ctx.needs});

  // Account creation and the application form kept apart (owner, 8 Oct 2026). The posting's Apply leads to a sign-up page: the extension leaves it alone and
  // the session shows the account step, no form progress. The test, as the person, creates the account; the form behind it is filled from the kit and the
  // session moves on to the form. Nothing typed on the sign-up page is learned as an answer or a fill miss, and "Create account" is not the application sent.
  await ctx.run('a sign-up page before the form: the account step is kept apart from the application form', async () => {
    const appLog = () => appLogText(ctx.profile);
    await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [SIGNUP.url, {title: SIGNUP.title, company: SIGNUP.company}]);
    const find = url => ctx.browser.context.pages().find(item => item.url().startsWith(url)) || null;
    let tab = null;
    for (let waited = 0; waited < 60000 && !tab; waited += 1000) { tab = find(SIGNUP.accountUrl); await pause(1000); }
    if (!tab) { await dumpExtension(); throw new Error(`the sign-up page was never reached. Tabs: ${ctx.browser.context.pages().map(item => item.url()).join(' | ')}`); }
    const session = async () => (await page.evaluate(target => window.pilot.sessions(), null)).find(item => String(item.url || '').replace(/\/$/, '') === SIGNUP.url) || null;
    let at = null;
    for (let waited = 0; waited < 30000 && at?.stage !== 'account'; waited += 1000) { at = await session(); await pause(1000); }
    const problems = [];
    if (at?.stage !== 'account') problems.push(`on the sign-up page the session is not at the account step (stage: ${at?.stage}, stuck: ${at?.stuck})`);
    if (await tab.locator('#signup_email').inputValue() !== '') problems.push('the extension filled the sign-up page (it must leave account pages to the person or Claude)');
    // The person creates the account: typed fields (trusted input), the box ticked, Create account pressed.
    await tab.fill('#signup_email', 'e2e.person@example.com');
    await tab.fill('#signup_username', 'e2e-person');
    await tab.fill('#signup_password', 'Fictional-Pass-1234');
    await tab.check('#robot');
    await tab.click('#create_account');
    let state = null;
    for (let waited = 0; waited < 60000; waited += 500) { if (tab.url().startsWith(SIGNUP.formUrl)) { state = await fillState(tab).catch(() => null); if (state?.state === 'done' || state?.state === 'error') break; } await pause(500); }
    if (state?.state !== 'done') problems.push(`the application form after the sign-up was not filled (at ${tab.url()}, state ${JSON.stringify(state)})`);
    else {
      const read = (await readForm(tab)).question_3001, value = String(read?.value ?? read ?? '');
      if (value !== '5') problems.push(`the form after the sign-up has Kubernetes years "${value}", its kit says 5`);
    }
    for (let waited = 0; waited < 20000 && at?.stage !== 'form'; waited += 1000) { at = await session(); await pause(1000); }
    if (at?.stage !== 'form') problems.push(`on the application form the session did not move to the form step (stage: ${at?.stage})`);
    const log = appLog();
    if (!/account page: answers typed there are not learned/.test(log)) problems.push('the answers typed on the sign-up page were not kept out of the learned answers (no "not learned" line in the app log)');
    if (!/account page: a sign-in or sign-up press, not an application submit/.test(log)) problems.push('"Create account" was not told apart from submitting the application');
    if (/learned.*Username|Username.*learned/i.test(log)) problems.push('"Username" from the sign-up page reached the learned answers');
    fail(problems);
  }, {needs: ctx.needs});

  // A sign-in page before the form where we have an account (8 Oct 2026: a saved site password + "email=" on its item = sign-in). The run's own password store
  // (never the Keychain: lib/keychain.js) holds the fixture host's test password with the applicant's email. The extension fills the email and the password, presses
  // "Sign in" once on the account AI's "ready", and the form behind it is filled from the kit; Settings → Credentials lists the host with the email. Then the same
  // page where the site refuses: pressed once, never again, and the person is told (Claude offered, never started).
  const seedSitePassword = host => {
    const file = path.join(ctx.profile, 'isolated-secrets.json');
    let items = {}; try { items = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* the first item */ }
    items[`job-pilotto.${host}.password`] = {value: SIGNIN_PASSWORD, account: 'job-pilotto', comment: `email=${CONTACT.email}`, created: new Date().toISOString()};
    fs.writeFileSync(file, JSON.stringify(items, null, 2), {mode: 0o600});
  };
  const openAccount = async fixture => {
    seedSitePassword(fixture.accountHost);
    await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [fixture.url, {title: fixture.title, company: fixture.company}]);
    let tab = null;
    for (let waited = 0; waited < 60000 && !tab; waited += 1000) { tab = ctx.browser.context.pages().find(item => item.url().startsWith(fixture.accountUrl)) || null; await pause(1000); }
    if (!tab) { await dumpExtension(); throw new Error(`the sign-in page was never reached. Tabs: ${ctx.browser.context.pages().map(item => item.url()).join(' | ')}`); }
    return tab;
  };
  const sessionOf = async fixture => (await page.evaluate(() => window.pilot.sessions())).find(item => String(item.url || '').replace(/\/$/, '') === fixture.url) || null;
  const pressesOf = fixture => forms.signinPosts.filter(post => post.path === fixture.accountPath);

  await ctx.run('a sign-in page before the form: your email and saved password are filled, "Sign in" is pressed once, and the form behind it is filled', async () => {
    const tab = await openAccount(SIGNIN);
    const problems = [];
    for (let waited = 0; waited < 60000 && !pressesOf(SIGNIN).length; waited += 500) await pause(500);
    const presses = pressesOf(SIGNIN);
    if (!presses.length) problems.push(`"Sign in" was never pressed (email box "${await tab.locator('#signin_email').inputValue().catch(() => '?')}" is ${await tab.locator('#signin_email').inputValue().catch(() => '') === CONTACT.email ? 'filled' : 'not filled'}, password box ${await tab.locator('#signin_password').inputValue().then(value => (value ? 'filled' : 'empty')).catch(() => '?')})`);
    else if (!presses[0].email || !presses[0].password) problems.push(`"Sign in" was pressed with the wrong ${!presses[0].email ? 'email' : 'password'} (the saved one for this site was not used)`);
    let state = null;
    for (let waited = 0; waited < 60000 && presses.length; waited += 500) { if (tab.url().startsWith(SIGNIN.formUrl)) { state = await fillState(tab).catch(() => null); if (state?.state === 'done' || state?.state === 'error') break; } await pause(500); }
    if (presses.length && state?.state !== 'done') problems.push(`the form after signing in was not filled (at ${tab.url()}, state ${JSON.stringify(state)})`);
    else if (presses.length) {
      const read = (await readForm(tab)).question_3001, value = String(read?.value ?? read ?? '');
      if (value !== '4') problems.push(`the form after signing in has Kubernetes years "${value}", its kit says 4`);
    }
    if (pressesOf(SIGNIN).length > 1) problems.push(`"Sign in" was pressed ${pressesOf(SIGNIN).length} times (once per tab is the floor)`);
    let at = null;
    for (let waited = 0; waited < 20000 && at?.stage !== 'form'; waited += 1000) { at = await sessionOf(SIGNIN); await pause(1000); }
    if (at?.stage !== 'form') problems.push(`after signing in the session did not move to the form step (stage: ${at?.stage}, stuck: ${at?.stuck})`);
    const log = appLogText(ctx.profile);
    for (const [line, why] of [[/sign_in page: filled with your details/, 'the sign-in page was not filled with your details'], [/site password given for a sign-in page/, 'the app did not give the saved password as a sign-in'],
      [/account button: pressed/, 'no "account button: pressed" decision in the app log'], [/account result: created/, 'the account AI\'s word after the press ("created") is not in the app log']]) if (!line.test(log)) problems.push(why);
    const rows = await page.evaluate(() => window.pilot.credentials());
    const row = (rows?.rows || []).find(item => item.host === SIGNIN.accountHost);
    if (!row) problems.push(`Settings → Credentials does not list ${SIGNIN.accountHost} (${rows?.ok ? `${rows.rows.length} row(s)` : rows?.error})`);
    else if (row.email !== CONTACT.email) problems.push(`Settings → Credentials lists ${SIGNIN.accountHost} with email "${row.email}", expected the applicant's`);
    fail(problems);
  }, {needs: ctx.needs});

  await ctx.run('a sign-in page before the form that refuses the password: "Sign in" is pressed once, never again, and you are told (Claude offered)', async () => {
    const tab = await openAccount(SIGNIN_REFUSED);
    const problems = [];
    for (let waited = 0; waited < 60000 && !pressesOf(SIGNIN_REFUSED).length; waited += 500) await pause(500);
    if (!pressesOf(SIGNIN_REFUSED).length) problems.push('"Sign in" was never pressed on the refusing page');
    let at = null;
    for (let waited = 0; waited < 30000 && at?.stuck !== 'account'; waited += 1000) { at = await sessionOf(SIGNIN_REFUSED); await pause(1000); }
    await pause(12000);   // several more looks of the extension (it looks every few seconds): a second press would show here
    const presses = pressesOf(SIGNIN_REFUSED).length;
    if (presses > 1) problems.push(`after the site refused, "Sign in" was pressed again (${presses} presses): a refused sign-in is never retried`);
    if (tab.url().startsWith(SIGNIN_REFUSED.formUrl)) problems.push('the refusing page somehow led to the form');
    if (at?.stuck !== 'account') problems.push(`the session does not say the account step needs you (stage: ${at?.stage}, stuck: ${at?.stuck})`);
    const log = appLogText(ctx.profile);
    if (!/account result: refused/.test(log)) problems.push('the account AI\'s "refused" is not in the app log');
    if (!/account page: the extension could not finish it: Claude is offered/.test(log)) problems.push('Claude was not offered after the refused sign-in');
    fail(problems);
  }, {needs: ctx.needs});

  // The account and the application on one page (Coop, 8 Oct 2026): a CV upload says it is the application. It is filled from the kit, the session is at the
  // form step, and its password boxes are never counted as questions the fill missed.
  await ctx.run('the account and the application on one page: it is the application form, its passwords stay account fields', async () => {
    await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [ONEPAGE.url, {title: ONEPAGE.title, company: ONEPAGE.company}]);
    let tab = null;
    for (let waited = 0; waited < 60000 && !tab; waited += 1000) { tab = ctx.browser.context.pages().find(item => item.url().startsWith(ONEPAGE.url)) || null; await pause(1000); }
    if (!tab) throw new Error(`the one-page form never opened. Tabs: ${ctx.browser.context.pages().map(item => item.url()).join(' | ')}`);
    let state = null;
    for (let waited = 0; waited < 90000; waited += 500) { state = await fillState(tab).catch(() => null); if (state?.state === 'done' || state?.state === 'error' || state?.state === 'account') break; await pause(500); }
    const problems = [];
    if (state?.state !== 'done') problems.push(`the one-page form was not filled as the application (state: ${JSON.stringify(state)}): a CV upload beside the password makes it the form`);
    else {
      const actual = await readForm(tab);
      const value = id => String(actual[id]?.value ?? actual[id] ?? '');
      if (value('first_name') !== CONTACT.first_name) problems.push(`first name "${value('first_name')}", expected ${CONTACT.first_name}`);
      if (value('question_3001') !== '3') problems.push(`Kubernetes years "${value('question_3001')}", its kit says 3`);
    }
    const sessionNow = async () => (await page.evaluate(() => window.pilot.sessions())).find(item => String(item.url || '').replace(/\/$/, '') === ONEPAGE.url) || null;
    let at = null;
    for (let waited = 0; waited < 20000 && at?.stage !== 'form'; waited += 1000) { at = await sessionNow(); await pause(1000); }
    if (at?.stage !== 'form') problems.push(`the session is not at the form step (stage: ${at?.stage}, stuck: ${at?.stuck}): this page is the application`);
    // The page's kind came from the AI (the stand-in), not the structure rule: the path every install takes when it has AI.
    if (!/page kind: account-form/.test(appLogText(ctx.profile))) problems.push('the one-page form\'s kind never came from the AI ("page kind: account-form" missing in the app log)');
    fail(problems);
  }, {needs: ctx.needs});

  // The form tab closed (owner, 8 Oct 2026): the app sees it, and Reopen opens the form again with the fill mark, for the same session, filled again.
  await ctx.run('the form tab is closed: the app sees it and Reopen opens the form again, filled, for the same session', async () => {
    for (const item of ctx.browser.context.pages()) if (item.url().startsWith(ONEPAGE.url)) await item.close();   // an earlier step's tab of the same job
    await pause(2000);
    await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [ONEPAGE.url, {title: ONEPAGE.title, company: ONEPAGE.company}]);
    const tabOf = () => ctx.browser.context.pages().find(item => item.url().startsWith(ONEPAGE.url)) || null;
    const filled = async tab => { for (let waited = 0; waited < 90000; waited += 500) { const state = await fillState(tab).catch(() => null); if (state?.state === 'done' || state?.state === 'error') return state; await pause(500); } return null; };
    let tab = null;
    for (let waited = 0; waited < 60000 && !tab; waited += 1000) { tab = tabOf(); await pause(1000); }
    if (!tab) throw new Error('the form never opened');
    if ((await filled(tab))?.state !== 'done') throw new Error('the form was not filled the first time');
    const session = (await page.evaluate(() => window.pilot.sessions())).find(item => String(item.url || '').replace(/\/$/, '') === ONEPAGE.url);
    if (!session) throw new Error('no session for the job');
    await tab.close();
    let forms = null;
    for (let waited = 0; waited < 45000; waited += 1000) { forms = await page.evaluate(() => window.pilot.formsOpen()); if (forms?.known && !forms.ids.includes(session.id)) break; await pause(1000); }
    const problems = [];
    if (!forms?.known || forms.ids.includes(session.id)) problems.push(`the app never saw the tab closed (forms open: ${JSON.stringify(forms)})`);
    const reopened = await page.evaluate(id => window.pilot.sessionReopen(id, false), session.id);
    if (!reopened?.ok) problems.push(`Reopen failed: ${JSON.stringify(reopened)}`);
    let again = null;
    for (let waited = 0; waited < 60000 && !again; waited += 1000) { again = tabOf(); await pause(1000); }
    if (!again) problems.push('Reopen opened no tab on the form');
    else {
      if (!again.url().includes('jobpilotto-fill')) problems.push(`the reopened tab has no fill mark: ${again.url()}`);
      if ((await filled(again))?.state !== 'done') problems.push('the reopened form was not filled again');
      const after = (await page.evaluate(() => window.pilot.sessions())).filter(item => String(item.url || '').replace(/\/$/, '') === ONEPAGE.url);
      if (after.length !== 1 || after[0].id !== session.id) problems.push(`the reopened form is not the same session (${after.map(item => item.id).join(', ')} vs ${session.id})`);
    }
    fail(problems);
  }, {needs: ctx.needs});

  // A second browser with the extension (8 Oct 2026: a test Chrome paired to the owner's app reported no tabs every few seconds, and the owner's open
  // Coop form flipped to "Form closed"). Each browser says what IT has open: a second one with no tabs never closes the first one's form.
  await ctx.run('a second browser with the extension and no tabs: the form open in the first stays open', async () => {
    for (const item of ctx.browser.context.pages()) if (item.url().startsWith(ONEPAGE.url)) await item.close();   // an earlier step's tab of the same job
    await pause(2000);
    await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [ONEPAGE.url, {title: ONEPAGE.title, company: ONEPAGE.company}]);
    let tab = null;
    for (let waited = 0; waited < 60000 && !tab; waited += 1000) { tab = ctx.browser.context.pages().find(item => item.url().startsWith(ONEPAGE.url)) || null; await pause(1000); }
    if (!tab) throw new Error('the form never opened');
    const session = (await page.evaluate(() => window.pilot.sessions())).find(item => String(item.url || '').replace(/\/$/, '') === ONEPAGE.url);
    if (!session) throw new Error('no session for the job');
    const openNow = async () => { const forms = await page.evaluate(() => window.pilot.formsOpen()); return forms?.known && forms.ids.includes(session.id); };
    let open = false;
    for (let waited = 0; waited < 60000 && !open; waited += 1000) { open = await openNow(); await pause(1000); }
    if (!open) throw new Error('the app never saw the form open in the first browser (nothing to protect: the row proves nothing)');
    const before = appLogText(ctx.profile).length;
    const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-second-spool-'));   // its own: the app's `open` still goes to the first browser
    const second = await launchBrowser({port: forms.port, spool, extensionDir: ctx.extensionDir});
    const problems = [];
    try {
      await second.serviceWorker();
      // Proof the second browser reached the app (its own report), then a minute of its empty reports: one every 30 s.
      let reached = false;
      for (let waited = 0; waited < 60000 && !reached; waited += 1000) { reached = /another browser run reports its tabs/.test(appLogText(ctx.profile).slice(before)); await pause(1000); }
      if (!reached) problems.push('the second browser never reported its tabs to the app ("another browser run reports its tabs" missing): the row proves nothing');
      for (let waited = 0; reached && waited < 65000; waited += 2000) {
        if (!(await openNow())) { problems.push(`the form was shown closed after the second browser reported (${Math.round(waited / 1000)} s in)`); break; }
        await pause(2000);
      }
    } finally { await second.close(); fs.rmSync(spool, {recursive: true, force: true}); }
    fail(problems);
  }, {needs: ctx.needs});

  // A wrong kind kept by the AI corrects itself (owner, 8 Oct 2026): the stand-in calls this application form a "posting". The extension finds no Apply to
  // press while the page has a form's fields, drops the kind (logged), and fills the form from the kit this visit.
  await ctx.run('the AI gave a page the wrong kind: the page contradicts it, the kind is dropped and the form is filled', async () => {
    await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [MISLABELLED.url, {title: MISLABELLED.title, company: MISLABELLED.company}]);
    let tab = null;
    for (let waited = 0; waited < 60000 && !tab; waited += 1000) { tab = ctx.browser.context.pages().find(item => item.url().startsWith(MISLABELLED.url)) || null; await pause(1000); }
    if (!tab) throw new Error('the mislabelled form never opened');
    let state = null;
    for (let waited = 0; waited < 90000; waited += 500) { state = await fillState(tab).catch(() => null); if (['done', 'error', 'no-form', 'account'].includes(state?.state)) break; await pause(500); }
    const problems = [];
    const log = appLogText(ctx.profile);
    if (!/page kind: posting/.test(log)) problems.push('the stand-in\'s wrong kind was never given (no "page kind: posting"): the row proves nothing');
    if (!/page kind corrected: a posting with no Apply but a form's fields/.test(log)) problems.push('the wrong kind was not corrected (no "page kind corrected" line)');
    if (!/page kind forgotten/.test(log)) problems.push('the app never dropped the kept kind (no "page kind forgotten" line)');
    if (state?.state !== 'done') problems.push(`the form was not filled after the correction (state: ${JSON.stringify(state)})`);
    else {
      const read = (await readForm(tab)).question_3001, value = String(read?.value ?? read ?? '');
      if (value !== '4') problems.push(`Kubernetes years "${value}", its kit says 4`);
    }
    fail(problems);
  }, {needs: ctx.needs});
}
