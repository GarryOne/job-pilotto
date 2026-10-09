// The extension server's wiring (moved out of main.js's start-up, 8 Oct 2026): what the local server asks of the app when the Chrome extension calls it: the site
// password, the form's review, the stuck report, the learned answers and fill misses, the visit routes, the tabs and the session reports. main.js
// passes in the services they share. A FLOW FILE (docs/flows/applying.md). Guards: the server, review, credentials and visits tests in desktop/test and
// the matrix (npm run flows).
import {claudeFamily} from './ai/names.js';
import * as aliasLibrary from './aliases.js';
import * as applyLib from './apply.js';
import * as contactDetails from './contact.js';
import * as controlEvents from './control-events.js';
import * as credentials from './credentials.js';
import * as learnedAnswers from './learned.js';
import * as misses from './misses.js';
import * as notionGate from './notion-gate.js';
import * as pipeline from './pipeline.js';
import * as recipeLibrary from './recipes.js';
import * as review from './review.js';
import * as server from './server.js';
import * as sharedLog from './shared-log.js';
import * as terminals from './terminals.js';
import * as visits from './visits.js';
import {flowState, leftCounts, missedQuestions, submitCounts, unplaced} from './question-labels.js';
import {log as appLog} from './log.js';
import {confirmAccount} from './account-confirm.js';
import {automationOf, modeOf, record} from './site-accounts.js';
import {resultOf} from './application-result.js';
// A test run never counts; a live-test twin does: its fills are real use (owner, 9 Oct 2026; lib/telemetry.js learningOff).
const testRun = () => !!process.env.JOB_PILOTTO_E2E;

export function registerExtServerHandlers(ctx) {
  const {DEMO, app, createWindow, cvOf, flow, notify, readSites, scoreVisitJobs, sessionNeedsYou, storage, getTelemetry, toWindow, getWindow, setRecipeReporter} = ctx;
  // A site with no account item yet gets the one job-site password (made the first time), kept under its own name so Settings →
  // Credentials lists it with the profile's email (owner, 8 Oct 2026: the whole flow by itself, one password reused everywhere).
  server.setSitePasswordHandler(async ({host, peek, session: sessionId} = {}) => {
    const company = String(terminals.record(String(sessionId || ''))?.company || '');   // the job's company: one host can serve several employers, each with its own account
    const applying = terminals.list().some(session => !session.outcome && !session.endedAt);
    if (DEMO || !applying || !credentials.forExtension(host, {applying, read: () => 'x'}).ok) {
      appLog('extension', 'site password refused', {host: String(host || '').slice(0, 120), applying});
      return {ok: false};
    }
    let answer = credentials.forExtension(host, {applying});
    let made = false;
    const email = await Promise.resolve(notionGate.connected(storage) ? contactDetails.read(storage) : {}).then(contact => contact?.email || '').catch(() => '');
    const mode = modeOf(storage.settings().siteAccounts, host, email, credentials.emailOf(host), !!answer.ok, company);   // our record, else the Credentials item (its email, or just that it exists): sign in first
    if (peek) return {ok: true, mode, email};   // the extension only asks which step this site is for this email (no password is made or read)
    if (!answer.ok) {
      const {code} = await pipeline.run(storage, ['src.ai.passwords', 'new', host, '--no-copy', ...(email ? ['--email', email] : [])]);
      made = code === 0;
      answer = credentials.forExtension(host, {applying});
      // The password item now carries this email, which the next page would read as "an account made earlier": say the sign-up is only under way.
      if (made && email && !storage.settings().siteAccounts?.[String(host).trim().toLowerCase()]) storage.saveSettings({siteAccounts: record(storage.settings().siteAccounts, host, email, 'creating', Date.now(), company)});
    }
    appLog('extension', 'site password given for a sign-in page', {host: String(host || '').slice(0, 120), made, given: !!answer.ok});   // which site, never the password
    // sign-in only where THIS email has an account on this site (recorded when a sign-up was confirmed); anywhere else the extension signs up.
    return answer.ok && email ? {...answer, email, mode, automation: automationOf(storage.settings())} : answer;   // the email goes into the account's email box, as the password goes into its password boxes
  });
  // The extension pressed a sign-up page's button: this email has an account on this host now, unconfirmed until its mail's link is opened (never the address in a log).
  server.setAccountPressedHandler(async ({host, state, session} = {}) => {
    const email = await Promise.resolve(notionGate.connected(storage) ? contactDetails.read(storage) : {}).then(contact => contact?.email || '').catch(() => '');
    if (!host || !email) { appLog('extension', 'account made but not recorded', {host: String(host || '').slice(0, 120), email: !!email}); return; }
    if (state === 'refused') {   // a sign-in with this email was refused here (the account judge, any language): no account yet; the next look signs up (under full)
      storage.saveSettings({siteAccounts: record(storage.settings().siteAccounts, host, email, 'refused', Date.now(), terminals.record(String(session || ''))?.company || '')});
      appLog('extension', 'sign-in refused: no account for this email on this site, sign-up next', {host: String(host).slice(0, 120)});
      return;
    }
    // confirmed: usable at once (signed in, or the site moved on); exists: it was there before, the sign-in is tried; pending: a confirmation mail (or a code) is awaited.
    const usable = state === 'confirmed' || state === 'exists';
    storage.saveSettings({siteAccounts: record(storage.settings().siteAccounts, host, email, usable ? 'confirmed' : 'pending', Date.now(), terminals.record(String(session || ''))?.company || '')});
    if (session) terminals.setAccount(session, state === 'confirmed' ? 'created' : state === 'exists' ? 'exists' : 'confirm');   // the session card says so
    appLog('extension', usable ? `account ${state === 'exists' ? 'already exists: the sign-in is tried' : 'created: usable at once'}` : 'account created: waiting for the confirmation', {host: String(host).slice(0, 120)});
    // A mail to confirm: looked for in the background (Gmail, read-only; the AI picks the link or code): its link opens in the extension's Chrome.
    if (!usable && !DEMO) confirmAccount({host, email, run: args => pipeline.run(storage, args), open: link => applyLib.openOne(link),
      mark: () => { storage.saveSettings({siteAccounts: record(storage.settings().siteAccounts, host, email, 'confirmed', Date.now(), terminals.record(String(session || ''))?.company || '')}); if (session) terminals.setAccount(session, 'created'); }}).catch(error => appLog('extension', 'account confirmation failed', {error: String(error?.message || error).slice(0, 120)}));
  });
  // A page of a session's form reported: its tab is open, so a stopped Claude session is not "Ended" (terminals.formInChrome).
  const formSeen = id => { if (id && terminals.formInChrome(id)) appLog('sessions', 'form open in Chrome: the session is active again', {id}); };
  server.setReviewHandler(payload => {
    const report = review.report(terminals.list(), payload);
    if (report.matched && report.session) formSeen(report.matched);
    return report.session ? {...report, cv: cvOf(report.session.url), claudeHelp: !!storage.settings().claudeConsent && claudeFamily(storage)} : report;   // the one Claude switch (renderer/claude-help.js)
  });
  // Each send is logged with its counts (never its content): "is the twin's fill reaching the site?" was unanswerable on 9 Oct 2026.
  const recipeReporter = recipeLibrary.createReporter(storage, {onSent: (what, sent) => {
    sharedLog.add(storage, what, sent);
    appLog('recipes', `sent to the site: ${what}`, {cards: sent?.cards?.length || 0, proposalUses: sent?.proposalUses?.length || 0, samples: sent?.samples?.length || 0, outcomes: sent?.outcomes?.length || 0});
  }});
  setRecipeReporter(recipeReporter);   // main.js keeps it: the other handler groups reach it through a getter
  // How an application ended (submitted clean / assisted / by Claude, or failed and where): one fixed word per finished application, by board. Never from a test run.
  terminals.onOutcome(session => {
    if (testRun()) return;
    const state = review.allStates().find(item => item.id === session.id);
    const result = resultOf(session, state);
    if (!result) return;
    let host = '';
    for (const address of [state?.url, session.accountHost ? `https://${session.accountHost}/` : '', session.url]) { try { host = new URL(address).hostname; break; } catch { /* the next one */ } }
    const board = controlEvents.boardName(host);
    recipeReporter.flow(board, result);
    appLog('sessions', `application ended: ${result}`, {board, id: session.id});
  });
  server.setProposalReporter(items => recipeReporter.proposal(items));
  server.setAnswerReporter(trace => { if (!testRun()) recipeReporter.answer(trace); });   // per-AI-family answer metrics, never from a test run
  // After a search: how much of the market the role keywords caught (data/coverage.json, src/coverage.py), as anonymous counts, once per crawl.
  pipeline.onRunEnd(({args, code}) => {
    if (code !== 0 || args[1] !== 'daily') return;
    try {
      const summary = JSON.parse(storage.readText('data/coverage.json') || 'null');
      if (!summary?.at || storage.settings().intelCoverageAt === summary.at) return;
      storage.saveSettings({intelCoverageAt: summary.at});
      recipeReporter.coverage(summary);
    } catch { /* a number for the product is never worth a failed run */ }
  });
  const shared = (what, sent) => sharedLog.add(storage, what, sent);
  server.setSharedLogger(shared);
  server.setRecipesHandler(payload => recipeLibrary.lookup(storage, payload.fingerprints, {onSent: shared}));
  server.setAliasesHandler(() => aliasLibrary.forExtension(storage, {onSent: shared}));   // shared meanings + this Mac's (lib/contact-keys.js)
  const owner = () => !!process.env.JOB_PILOTTO_OWNER;   // the owner's own installs name sites in plain, to debug with
  // Sites only you can open (lib/visits.js): the extension sends each page the person asked it to read; the hosts light its icon.
  let visitHosts = ['linkedin.com', 'indeed.', 'glassdoor.', 'levels.fyi'];
  const refreshVisitHosts = () => pipeline.run(storage, ['src.desktop', 'visit-list']).then(({stdout}) => {
    const listed = JSON.parse(String(stdout).trim().split('\n').pop() || '{}').visits || [];
    visitHosts = [...new Set([...visitHosts, ...listed.map(item => { try { return new URL(item.url).hostname.replace(/^www\./, ''); } catch { return ''; } }).filter(Boolean)])];
  }).catch(error => appLog('visit', 'visit list not read', {error: error.message}));
  if (!DEMO) setTimeout(refreshVisitHosts, 20000);
  server.setVisitHosts(() => visitHosts);
  server.setVisitFilters(page => visits.filters(storage, page));
  server.setVisitRoute('/extension/visit-understand', outline => visits.understand(storage, outline));
  server.setVisitRoute('/extension/visit-unblock', page => visits.unblock(storage, page));
  server.setVisitRoute('/extension/visit-recipe', page => visits.recipe(storage, page));
  server.setVisitRoute('/extension/visit-jobpage', page => visits.jobPage(storage, page));   // a home page: where its job list is
  server.setVisitRoute('/extension/visit-done', payload => visits.done(payload));
  server.setVisitRoute('/extension/posting', payload => visits.posting(storage, payload));   // a posting read in your browser ("Jobs we couldn't read")
  server.setVisitRoute('/extension/visit-waiting', payload => visits.waitingFor(payload));
  server.setVisitRoute('/extension/visit-state', payload => visits.stepOf(payload));   // what each read tab is doing, live in its row
  let waitingSaid = 0;
  visits.onWaiting(() => {   // once a run: a notification that brings Chrome forward on click
    if (Date.now() - waitingSaid < 10 * 60000) return;
    waitingSaid = Date.now();
    notify('Job Pilotto is waiting for you in Chrome', 'Press "Allow on the sites the app opens" once: then it reads the sites by itself.', () => visits.focusBrowser());
  });   // the extension waits on the person: said, not "reading"   // a tab the Actions task opened has been read
  server.setVisitHandler(async page => {
    const answer = await visits.read(storage, page);
    // A page you read by your own click is said at once; one read for a Find jobs using your browser run (it has a ticket) is said by that run's card, which also
    // starts the search (7 Oct 2026: a toast per page said "your next jobs check scores them" while the card said a search had started).
    if (answer.ok && !page?.ticket) toWindow('visit-read', answer);
    return answer;
  });
  server.setMissesHandler(payload => misses.record(storage, payload, Date.now(), prints => {
    for (const item of controlEvents.fromMisses(payload, prints, {owner: owner()})) getTelemetry()?.record('control', item);
    recipeReporter.sample((payload.items || []).filter(item => prints.has(item.fingerprint)));   // the structure of a new kind of control, no text
  }));
  server.setControlsHandler(payload => {
    for (const item of controlEvents.fromOperators(payload, {owner: owner()})) getTelemetry()?.record('control', item);
    recipeReporter.outcome(payload.items);   // counts per fingerprint and recipe: the canary's evidence
    const board = controlEvents.boardName(payload.host);
    if (Array.isArray(payload.trace)) recipeReporter.fill(board, payload.required);   // one more form on this board (only a fill report carries the trace; a flow or alias event is not a fill)
    recipeReporter.question((Array.isArray(payload.buttons) ? payload.buttons : []).map(label => ({label, kind: 'button'})), board);   // button texts of a page with no Apply button we knew
    recipeReporter.question((Array.isArray(payload.uploads) ? payload.uploads : []).map(label => ({label, kind: 'upload'})), board);   // titles of upload slots no meaning knew
    recipeReporter.alias(payload.aliasUse);   // which label meanings from the service placed a question, and whether the field took it
    recipeReporter.fillQuality(payload.filled, payload.corrections);   // which answers were filled, and which the person changed by hand (labels only)
    recipeReporter.question(unplaced(payload.trace), board);   // the form's own wording for questions no answer matched
    const left = leftCounts(payload.trace);
    recipeReporter.unfilled(board, left);   // why fields stayed empty: counts per fixed reason word
    const unreadCount = left.find(c => c.reason === 'unread')?.n || 0;
    if (unreadCount) appLog('review', `fill: ${unreadCount} required question(s) on the page not read`, {board});
    if (payload.flow) recipeReporter.flow(board, flowState(payload.flow));   // where an application got to on this board
    if (payload.card) recipeReporter.card(board, payload.card);   // this fill's anonymous record (extension/fill-card.js)
    if (payload.byYou || payload.invalid || payload.fillId) {   // at Submit: what the fill missed (the person answered it, or the page flagged it)
      const counts = submitCounts(payload);
      if (payload.fillId) recipeReporter.submit(payload.fillId, {submitted: payload.submitted, ...Object.fromEntries(counts.map(c => [c.reason, c.n]))});
      recipeReporter.unfilled(board, counts);
      recipeReporter.question(missedQuestions(payload), board);
      appLog('review', `at submit: ${counts.map(c => `${c.n} ${c.reason}`).join(', ') || 'nothing missed'}`, {board});
    }
  });
  server.setLearnedHandler(payload => learnedAnswers.save(storage, payload, {notify: (title, body) => toWindow('toast', {title, body}), contactSaved: contact => server.contactSaved(storage, contact)}));
  server.setTabsHandler(report => {
    const sessions = terminals.list();
    review.noteTabs(report, new Set(sessions.map(session => session.id)));
    for (const session of sessions) if (review.tabOpen(session.id) === true) formSeen(session.id);   // a restarted app: its form is still open
    return visits.noteTabs(report);
  });   // one tab report: form tabs (Applying) and read tabs (Find jobs using your browser)
  server.setJoinHandler(tabs => review.tabsToArm(terminals.list(), tabs));
  server.setFocusHandler(payload => review.noteFocus(terminals.list(), payload));
  server.setOpenHandler(id => {
    if (!terminals.get(id)) return false;
    if (!getWindow() || getWindow().isDestroyed()) createWindow();
    getWindow().show();
    getWindow().focus();
    app.focus({steal: true});
    toWindow('session', 'open', {id});
    return true;
  });
  server.setStuckHandler(event => { flow().stuck(event); });   // tier 3: the extension can't reach a form (lib/session-flow.js)
  review.onBind(({id, tab, before, by, host}) => appLog('review', `tab ${tab} is session ${id}'s now`, {before, by, host}));   // which tab a session follows, and why
  review.setReporter(state => flow().reported(state));   // the step each form report puts its session at (lib/session-flow.js)
  const readReported = new Set();
  // (readSites, set when a Read with Claude session starts: its sites' addresses, so each site's button is told when it ends)   // Read with Claude sessions already reported (a session's Stop can arrive more than once)
  server.setSessionReporter((id, info) => {
    const {session, needsYou} = terminals.report(id, info);
    if (session && needsYou) sessionNeedsYou(session);
    // A Read with Claude session that finished: what it saved, said like the extension's reads (log, toast, the site's button) and scored
    // (owner, 7 Oct 2026: "Read with Claude never reports back"). Its pages were saved under its session name (claude-session.js readPrompt).
    if (session?.kind === 'read' && session.status === 'done' && !readReported.has(id)) {
      readReported.add(id);
      visits.claudeResult(storage, id).then(result => {
        appLog('visit', 'read with Claude finished', {host: (() => { try { return new URL(session.url).hostname; } catch { return ''; } })(), jobs: result?.jobs ?? 0, fits: result?.fits ?? 0});
        toWindow('visit-claude-done', {url: session.url, urls: readSites.get(id) || [session.url], name: result?.name || session.company || '', jobs: result?.jobs || 0, fits: result?.fits || 0});
        scoreVisitJobs(result?.fits || 0, 'read with Claude');
      }).catch(error => appLog('visit', 'read with Claude result not read', {error: error.message}));
    }
  });
}
