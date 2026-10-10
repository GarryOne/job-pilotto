// Application sessions: the dock, the list, the next step.
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {avatar} from '../jobs-view.js';
import {PROBLEM, isDevTalk, latestStep, readSessionMessage, sortChecks, splitLabel} from '../session-message.js';
import {accountProgress, applyingBadge, asksYou, dockCounts, dockOrder, firstLine, isLive, isSubmitted, panelAnswered, sessionDuration, sessionReview, sessionStage, sessionState, accountRecordLine} from '../session-state.js';
import {shared} from './shared.js';
import {claudeHelp} from '../claude-help.js';
import {offerParts} from '../claude-offer.js';
import {hasSessionCache, rememberSessions, rememberedSessions} from '../sessions-cache.js';
import {$, osText, show} from './core.js';
import {initOptional, showOptional} from './session-optional.js';
import {pageKey} from './jobs.js';
import {richText} from './rich-text.js';
import {attachTerminal, fitTerminal, openSession, renderSessionPage, say} from './session-log.js';
import {applyFormStates, askRow, reviewStates, opening, openForm, reopenClosedTab, checkingTab, silentChrome, formGone, formReady, emptyFields, emptyRow, explainExtension, needRow, showFormState, showSendBar, updateNeedsCount, watchAgreements} from './session-needs.js';
import {toastMessage} from './startup.js';
import {cancelSession, closeSession, pauseSession, removeSession, restartSession, resumeSession, skipSession} from './session-actions.js';
import {storeName} from '../store-words.js';
export {cancelSession, removeSession, restartSession, resumeSession, skipSession};

// Other pages import these from here.
// The state other pages show uses the form page's state too: ready to submit once the form says so.
const closedForm = item => formGone(item);  // its Chrome tab was closed (a form or a Claude session's)
const sessionStatus = item => (checkingTab(item) ? ['Checking…', 'neutral'] : silentChrome(item) ? ['Chrome not reporting', 'warn'] : closedForm(item) ? ['Form closed', 'neutral'] : sessionState(item, formReady(item)));
export {firstLine, isLive, sessionDuration, sessionReview, sessionStatus as sessionState};
export const SESSION_PILL = {running: {label: 'Applying', tone: 'info'}, input: {label: 'Needs input', tone: 'warn'}, done: {label: 'Form filled', tone: 'good'}};
export let sessionList = [], logChoice = {};
// Sessions whose form page has just failed to answer the app: only those are offered the "Reload the tab" repair
// (it reloads a form page, so it must not sit in the row by default). Cleared when the page answers again.
const panelDead = new Set();
// Set once the app has answered with its sessions: until then "no open session" can't be told from "not loaded yet".
export let sessionsLoaded = false;
// True while the page shows the remembered list: the heading says "Updating…" until the app's own list is in.
export let sessionsFromCache = false;

// ---------- Application sessions: Apply with Claude inside the app (lib/terminals.js) ----------
// A dock of cards above the activity bar (one per session) and a session page with the live terminal (xterm.js),
// Claude's question when it waits for you, quick answers and a message box. Sessions report their state through
// Claude Code hooks; the app notifies you when one needs you.
export function sessionFor(url) {
  const key = pageKey(url || '');
  return sessionList.filter(item => pageKey(item.url) === key).pop() || null;
}
export const sessionJob = item => shared.allJobs.find(job => pageKey(job.url) === pageKey(item.url)) || {};
export const sessionTitle = item => item.title || sessionJob(item).title || 'Application';
export const sessionCompany = item => item.company || sessionJob(item).company || new URL(item.url || 'https://job').hostname.replace(/^www\./, '');
// A submitted application is finished work: it lives on Jobs, not on this screen. A Read with Claude session is not an application at all
// (owner, 7 Oct 2026: "this is only for applying to jobs"): its result is in Recent activity. This list feeds the page, the badge, the dock and
// "N sessions need you", so leaving it out here leaves it out of all of them.
const stillOpen = items => (items || []).filter(item => !isSubmitted(item) && item.kind !== 'read');
export async function refreshSessions() {
  const fresh = await window.pilot.sessions().catch(() => null);
  if (fresh) { sessionList = stillOpen(fresh); rememberSessions(sessionList); }  // a failed read keeps what we have, it doesn't blank it
  sessionsLoaded = true;
  sessionsFromCache = false;
  // Paint before listeners run: one of them throwing used to skip the paint and leave the spinner up.
  const page = document.querySelector('.view[data-view="sessions"]');
  if (page && !page.hidden) renderSessionPage();
  document.dispatchEvent(new Event('sessions-loaded'));
  renderDock();
}
// The last known sessions paint at once on the next load (the app's own list replaces them in refreshSessions).
// Here rather than in a page module: an imported binding is read-only, so only this module can set it.
if (!sessionList.length) {
  const kept = rememberedSessions();
  // An empty remembered list is an answer too (the last sessions were submitted): the page shows that, not the spinner.
  if (kept.length || hasSessionCache()) { sessionList = stillOpen(kept); sessionsFromCache = true; }
}

export function sessionLogo(item) {
  const {initials, hue} = avatar(sessionCompany(item));
  const badge = el('span', 'logo', initials);
  badge.style.setProperty('--hue', hue);
  return badge;
}
// The sessions most worth opening first: waiting for your answer, a review whose form isn't complete yet, working,
// ready to submit, then the rest (latest first).
const urgency = item => (item.status === 'input' && !sessionReview(item, formReady(item)) ? 0 : sessionReview(item, formReady(item)) && !formReady(item) ? 1
  : isLive(item) && item.status === 'running' ? 2 : sessionReview(item, formReady(item)) ? 3 : 4);
export function bestSession() {
  return [...sessionList].sort((a, b) => urgency(a) - urgency(b) || Date.parse(b.startedAt || 0) - Date.parse(a.startedAt || 0))[0] || null;
}
// The menu's foot: "1 session needs you" (amber), "2 applying" (blue), "1 ready to submit" (green), else how many there are.
function renderNavBadge() {
  const open = sessionList.filter(item => !item.endedAt || sessionReview(item, formReady(item)));
  const needs = open.filter(item => urgency(item) <= 1).length, working = open.filter(item => urgency(item) === 2).length;
  const ready = open.filter(item => urgency(item) === 3).length;
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const [text, tone] = needs ? [`${plural(needs, 'session')} need${needs === 1 ? 's' : ''} you`, 'warn']
    : working ? [`${working} applying`, 'info'] : ready ? [`${ready} ready to submit`, 'good'] : [plural(sessionList.length, 'session'), 'neutral'];
  const {count, tone: countTone} = applyingBadge(sessionList, urgency);
  Object.assign($('nav-applying-badge'), {hidden: !count, textContent: count, className: `nav-badge tone-${countTone}`, title: text});
  $('nav-sessions').hidden = !sessionList.length;
  $('nav-sessions').className = `nav-sessions tone-${tone}`;
  $('nav-sessions-text').textContent = text;
}
export function renderDock() {
  renderNavBadge();
  const live = sessionList.filter(item => !item.endedAt || item.status === 'done');
  // Not on the sessions page itself (it lists them all): the tray would only repeat what's on screen.
  const onSessionsPage = !document.querySelector('.view[data-view="sessions"]')?.hidden;
  show($('sessions-dock'), sessionList.length > 0 && !onSessionsPage);
  if (!sessionList.length) return;
  const {active: running, waiting} = dockCounts(sessionList, closedForm);
  // Two pills: how many are active (blue), how many wait for you (amber).
  $('sd-summary').replaceChildren(pill(`${running} active`, 'info'), ...(waiting ? [pill(`${waiting} need${waiting === 1 ? 's' : ''} input`, 'warn')] : []));
  $('sd-toggle').setAttribute('aria-expanded', shared.dockOpen);
  $('sessions-dock').classList.toggle('is-closed', !shared.dockOpen);
  const shown = [...(live.length ? live : sessionList)].sort((a, b) => dockOrder(a, closedForm) - dockOrder(b, closedForm)).slice(0, 3);
  $('sd-cards').replaceChildren(...shown.map(item => {
    const [label, tone] = sessionStatus(item);
    const card = el('div', `sd-card tone-${tone}`);
    const words = el('div', 'sd-words');
    const title = el('b', 'focus-headline', `${sessionCompany(item)} · ${sessionTitle(item)}`);
    title.title = title.textContent;
    const state = el('div', 'sd-state');  // the badge, then what it's doing (or asking), on one line under the title
    const note = el('span', 'muted small sd-note', isSubmitted(item) ? 'Marked Applied' : item.status === 'input' ? item.brief || item.note || '' : item.note || '');
    note.title = note.textContent;
    state.append(pill(label, tone, {dot: item.status === 'running'}), note);
    words.append(title, state);
    const action = el('button', item.status === 'input' ? 'primary' : 'secondary', item.status === 'input' ? 'Respond' : item.status === 'done' ? 'Review' : 'Open session');
    action.addEventListener('click', () => openSession(item.id));
    card.addEventListener('click', event => { if (!event.target.closest('button')) openSession(item.id); });  // the whole card
    card.append(sessionLogo(item), words, action);  // stop / open posting: on the session page (⋯), keeping cards compact
    return card;
  }));
}
export function sessionMenu(item) {
  const menu = [{icon: 'external', label: 'Open posting', run: () => window.pilot.openExternal(item.url)}];
  if (isLive(item)) menu.push({label: '⏸ Pause Claude (Esc)', run: () => pauseSession()});
  if (item.resumable && !isSubmitted(item) && claudeHelp()) menu.push({label: '▶ Resume Claude', run: () => resumeSession(item)});
  if (isLive(item)) menu.push({label: '⏹ Stop Claude', run: () => window.pilot.sessionStop(item.id)});
  menu.push({label: '✕ Close this session', danger: true, run: () => closeSession(item)});
  return menu;
}
// Live while Claude works: a ticking duration, and its latest step from the log (the last "●" line it wrote).
export const sessionTail = {};  // the end of each session's output, for its latest step
export function ticking(node, prefix, since) {
  Object.assign(node.dataset, {since, prefix});
  node.textContent = prefix + sessionDuration({startedAt: since});
  return node;
}
const hhmmOf = iso => new Date(iso).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
// Open or closed as you last left it for this session; until then open while Claude works.
export function openLog(open, remember = true) {
  if (remember && shared.openSessionId) logChoice[shared.openSessionId] = open;
  show($('ss-log-body'), open);
  show($('ss-log-last'), !open);
  $('ss-expand').textContent = open ? 'Collapse log' : 'Expand log';
  $('ss-expand').setAttribute('aria-expanded', open);
  if (open) setTimeout(async () => {
    if (shared.termShownFor !== shared.openSessionId) await attachTerminal(shared.openSessionId);
    else fitTerminal();
    if (remember) shared.xterm?.focus();
  }, 30);
}
function sessionButton(text, kind, run, glyph) {
  const button = el('button', `${kind}${glyph ? ' with-icon' : ''}`);
  if (glyph) button.append(icon(glyph));
  button.append(el('span', '', text));
  button.addEventListener('click', run);
  return button;
}
// A row that shows one line and unfolds the rest on click (a › that turns).
function foldRow(short, more) {
  const li = el('li', 'ss-check');
  const line = el('div', 'ss-check-line');
  const words = el('span', 'ss-check-text');  // one flow of text (a `code` chip would otherwise be its own column)
  words.append(...richText(short).flatMap(node => [...node.childNodes]));
  line.append(icon('chevron'), words);
  li.append(line);
  if (!more) return li;
  const detail = el('div', 'muted small ss-check-more');
  detail.append(...richText(more));
  detail.hidden = true;
  li.classList.add('has-more');
  li.addEventListener('click', () => { detail.hidden = !detail.hidden; li.classList.toggle('is-open', !detail.hidden); });
  li.append(detail);
  return li;
}
let fullFor = null, reportFor = null;  // the session whose Claude's message the banner shows (folded again for another one)
// "I submitted it": you sent the application and the app missed it (the Jobs row and Notion move to Applied). On every
// unsubmitted state of a session, so a missed submit can always be put right by hand.
const submittedButton = item => sessionButton('I submitted it', 'secondary', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  const result = await window.pilot.setStatus(item.url, 'applied').catch(error => ({ok: false, error: error.message}));
  if (!result.ok) { button.disabled = false; toastMessage('Not marked Applied', result.error || 'Try again.'); return; }
  button.textContent = '✓ Marked Applied';
}, 'check');
// Where to answer: the button opens the reply box in the log below (a quick reply there sends one tap of text).
const answerHint = () => el('p', 'rich-p muted small', 'Press Answer, then type your reply in the log below, or use a quick reply there.');
// While the app checks Chrome for the session's tab: a loading card (the existing .skeleton lines), nothing from the last state.
function renderChecking() {
  $('ss-decision').className = 'ss-next tone-neutral';
  $('ss-next-title').textContent = 'Checking Chrome for this application\u2026';
  $('ss-next-state').textContent = '';
  $('ss-stage').replaceChildren();
  $('ss-form-state').replaceChildren();
  $('ss-question').replaceChildren(el('span', 'skeleton w-80'), el('span', 'skeleton w-60'));
  $('ss-actions').replaceChildren(el('span', 'skeleton button'), el('span', 'skeleton button small'));
  for (const id of ['ss-form-card', 'ss-needs-card', 'ss-happened-card', 'ss-full-toggle', 'ss-full']) show($(id), false);
}
// Chrome hasn't reported (closed, or the extension isn't running): the card can't know the tab, so it says that, with the way
// back (the extension's own page, which starts it reporting); it updates by itself once Chrome reports.
function renderSilent() {
  renderChecking();
  $('ss-decision').className = 'ss-next tone-warn';
  $('ss-next-title').textContent = 'Chrome isn\'t reporting';
  $('ss-question').replaceChildren(el('p', 'rich-p', 'Job Pilotto can\'t see this application\'s tab: Chrome is closed, or its Job Pilotto extension isn\'t running. Open Chrome and this card updates by itself.'));
  $('ss-actions').replaceChildren(sessionButton('Open Chrome', 'primary', async event => {
    const result = await opening(event.currentTarget, () => window.pilot.extensionOptions());
    window.pilot.uiLog('sessions: Chrome not reporting, Open Chrome pressed', {opened: !!result?.opened});
    if (!result?.opened) toastMessage('Chrome didn\'t open', 'Open Google Chrome yourself; the card updates once its Job Pilotto extension reports.');
  }, 'link'));
}
export function renderNextStep(item) {
  if (checkingTab(item)) { renderChecking(); return; }
  if (silentChrome(item)) { renderSilent(); return; }
  const submitted = isSubmitted(item);
  // Its Chrome tab was closed: that wins over "can't reach this form" (nothing to reach) and over what Claude last asked (about that tab).
  const gone = !submitted && formGone(item);
  const stuck = !submitted && item.kind === 'form' && !!item.stuck && !gone;   // the extension can't reach this form
  const review = !submitted && !stuck && sessionReview(item, formReady(item)), asking = !submitted && item.status === 'input' && !review, running = !submitted && item.status === 'running';
  const {checks, needs: forYou, audit, done, intro} = readSessionMessage(submitted ? '' : item.question);
  const tone = submitted ? 'good' : review || asking || stuck ? 'warn' : running ? 'info' : item.status === 'failed' ? 'bad' : 'neutral';
  $('ss-decision').className = `ss-next tone-${tone}`;
  const brief = item.brief || '';
  const ask = asksYou(item) && /\?$/.test(brief) ? brief : '';
  $('ss-next-title').textContent = submitted ? 'Submitted'
    : stuck ? (item.stuck === 'account' ? (item.accountStep === 'sign_in' ? `Sign in${item.accountHost ? ` to ${item.accountHost.replace(/^www\./, '')}` : ''}` : 'This site needs an account') : item.stuck === 'incomplete' ? 'The extension filled nothing here' : 'The extension can\'t reach this form')
    : gone ? 'The form tab was closed'
    : review ? 'Review the filled application'
    : asking ? ask || 'Claude needs your answer'
    : running ? 'Claude is filling the application' : item.status === 'failed' ? 'The session stopped' : 'The session ended';
  // Its state, after the title: finished (when), waiting (since when) or working (for how long).
  const since = item.needsYouSince || item.endedAt || item.startedAt;
  const state = $('ss-next-state');
  state.textContent = submitted ? `· ended at ${hhmmOf(since)}`
    : stuck ? (item.stuck === 'account' ? accountProgress(reviewStates.get(item.id)) : '· nothing filled yet')
    : review ? (item.kind === 'form' || item.inChrome ? `· form opened at ${hhmmOf(since)}` : `· Claude finished at ${hhmmOf(since)}`) : asking ? (isLive(item) ? `· waiting since ${hhmmOf(since)}` : '· Claude closed with the app')
    : running ? '· working' : `· ended at ${hhmmOf(since)}`;
  const stage = sessionStage(item);
  $('ss-stage').replaceChildren(...(stage ? [pill(stage.text, stage.tone, {dot: true})] : []));
  if (running) ticking(state, '· working for ', item.startedAt); else { delete state.dataset.since; delete state.dataset.prefix; }
  // What to read: one line when the form is ready (Claude's words one click away), else Claude's own text.
  const said = intro.filter(line => line.replace(/\*/g, '') !== ask && !isDevTalk(line));
  $('ss-question').replaceChildren(...(submitted ? [el('p', 'rich-p', `Marked Applied in ${storeName()}. The confirmation page in Chrome is what decided it.`)]
    : stuck ? [el('p', 'rich-p', item.stuck === 'account'
      ? 'The form is behind a sign-in or sign-up. The extension fills it in Chrome; a robot check or a choice there is yours. If it stays stuck, Claude can take over; you still submit the application.'
      : item.stuck === 'incomplete' ? 'The form is open in Chrome, but the extension could not fill any of it and required fields are still empty. Fill them there, or let Claude take over; you still submit the application.'
      : 'This page has no form the extension can open by itself (no Apply button it may press, or it leads to another site). Open it in Chrome to go on; if it stays stuck, Claude can find the form and fill it; you still submit it.'),
      // The next press, in the AI's own words (e.g. 'Solve the check, then press "Créer un compte"'): what is left for you on this page.
      ...(['account', 'incomplete'].includes(item.stuck) && item.accountNeeds ? [el('p', 'rich-p', el('b', '', 'Left for you: '), item.accountNeeds)] : [])]
    : gone && asking ? [el('p', 'rich-p', 'Claude was working in the Chrome tab you closed, so its last question was about that tab. Reopen form opens it again (you choose whether to start over); then Resume Claude carries on there.')]
    : gone ? [el('p', 'rich-p', item.kind === 'form' ? 'You closed the form\'s Chrome tab. Reopen it and the extension fills it again from your kit. If you submitted it, the extension has already marked it Applied.' : 'The filled form was in the Chrome tab you closed. Reopen it to fill it again from your kit, or mark it submitted if you already sent it.')]
    : review ? [el('p', 'rich-p', item.kind === 'form' || item.inChrome ? 'The extension fills the form in Chrome. Check the answers and legal boxes there, then submit it yourself.' : 'Check the answers and legal boxes in Chrome, then submit it yourself.')]
    : asking ? (forYou.length
      // Claude listed what it needs: its first sentence for context, then each thing as a line, then where to answer.
      ? [...(said.length ? [el('p', 'rich-p', said[0].replace(/\*\*/g, ''))] : []), el('p', 'rich-p', el('b', '', 'What Claude needs from you:')),
        ...forYou.map(line => el('p', 'rich-p', `→ ${line.replace(/\*\*/g, '')}`)), ...(isLive(item) ? [answerHint()] : [])]
      : [...(said.length ? richText(said.join('\n')) : [el('p', 'rich-p', 'Claude is waiting for you.')]), ...(isLive(item) ? [answerHint()] : [])])
    : [Object.assign(el('p', 'rich-p muted', (running && latestStep(sessionTail[item.id] || '')) || item.note || ''), {id: running ? 'ss-step' : ''})]));
  const full = $('ss-full');
  full.replaceChildren(...(review && item.question ? richText(item.question) : []));
  if (fullFor !== item.id) { full.hidden = true; fullFor = item.id; }
  // At the bottom of "What happened", folded: once the form is filled the cards say what to do; the report is there
  // for its exact words.
  const record = accountRecordLine(item);   // "Account created on X · terms accepted: '…' · code from your email" (session-state.js)
  if (record) $('ss-question').append(el('p', 'muted small', record));
  const toggle = $('ss-full-toggle');
  const label = () => { toggle.textContent = full.hidden ? 'Claude\'s full report ▾' : 'Claude\'s full report ▴'; };
  show(toggle, !!(review && item.question));
  label();
  toggle.onclick = () => { full.hidden = !full.hidden; label(); };
  const actions = [], live = isLive(item);
  if (stuck) {
    // Tier 3: the cheap ways ran out. Chrome first, Claude the safety net (owner, 9 Oct 2026: "remove the 'Apply with Claude' from being orange";
    // the panel's "Take over with Claude" is there while the form tab is open, this one when it isn't).
    if (item.url) actions.push(sessionButton('Open in Chrome', 'primary', async event => { await openForm(item, event.currentTarget); }, 'link'));
    const offer = offerParts(item, {rerender: () => renderNextStep(item), after: async result => { await refreshSessions(); if (result?.session?.id) openSession(result.session.id); }});   // claude-offer.js
    actions.push(...offer.buttons);
    if (offer.notes.length) $('ss-question').append(...offer.notes);
  }
  // Claude is the safety net, never the main action (owner, 9 Oct 2026: "remove Resume Claude from being orange"): always secondary; the way to the form is promoted below.
  const resume = () => sessionButton('Resume Claude', 'secondary', () => resumeSession(item), 'refresh');
  const pushResume = () => { if (claudeHelp()) actions.push(resume()); };   // only with Claude help on (claude-help.js)
  if (gone) {
    // Nothing to bring forward: the tab is gone. The app opens the job with the fill mark, the way "Fill in Chrome" does.
    actions.push(sessionButton('Reopen form', 'primary', event => reopenClosedTab(item, event.currentTarget), 'link'));
  }
  if (review) {
    if (!gone) actions.push(sessionButton('Open filled form', 'primary', async event => {
      const result = await opening(event.currentTarget, () => window.pilot.showBrowser(item.url, sessionCompany(item), item.id));
      // The page's panel answered: nothing to repair. When it didn't, the repair appears right here, and the row is
      // redrawn so it is there before the next click.
      if (panelAnswered(result)) {
        if (panelDead.delete(item.id)) renderSessionPage();
        return;
      }
      if (result?.went === 'none') { await reopenClosedTab(item, event.currentTarget); return; }   // no tab to bring forward: open the form again
      panelDead.add(item.id);
      renderSessionPage();
      toastMessage('Form tab not found', osText('The form\'s page didn\'t answer, so the extension isn\'t attached to it. '
        + 'Press Reload the tab — or ⌘R in that tab — then try again.'));
    }, 'link'));
    // A form page whose panel died (the extension was uninstalled and installed again) can't answer the app: reload
    // that tab, which is what puts the extension back onto it — then the focus handshake works again. Offered only
    // after a page has just failed to answer (panelDead), never as an everyday action: a reload loses whatever was
    // typed in the form since the last save (1 Oct 2026).
    if (panelDead.has(item.id) && !gone) actions.push(sessionButton('Reload the tab', 'secondary', async event => {
      const result = await opening(event.currentTarget, () => window.pilot.reviewReload(item.id, item.url, sessionCompany(item)));
      if (result?.result === 'reloaded' || result?.result === 'reloaded-chrome') {
        panelDead.delete(item.id);
        renderSessionPage();
        if (result.went !== 'tab') toastMessage('Reloaded, but no answer yet', 'The tab is fresh; give the extension a few seconds, then press Open filled form again.');
        return;
      }
      if (result?.outdated) {
        toastMessage('Reload the Chrome extension once', `Chrome runs Job Pilotto ${result.extension}; this app has ${result.latest}. ` +
          'In Chrome open chrome://extensions and click ↻ on Job Pilotto, then press again — it updates itself from then on.');
        return;
      }
      const why = {permission: 'macOS won\'t let Job Pilotto control Chrome: System Settings → Privacy & Security → Automation → Job Pilotto → Google Chrome. Or press ⌘R in that tab.',
        // Chrome running with no windows means an automation's headless Chrome holds the scripting connection, not
        // the window the user is working in: say so, rather than "no tab matches" about a tab that is right there.
        'no-window': osText('Chrome answered with no windows: a background Chrome (an automation\'s) holds the scripting connection, not the window you use. Press ⌘R in the tab you are reviewing.'),
        'no-tab': osText('No Chrome tab matches this job. If you apply in another browser or Chrome window, press ⌘R in its tab.'),
        'no-chrome': 'Google Chrome isn\'t running.',
        // Chrome's scripting is macOS-only. Saying "Chrome isn't running" on Windows would be untrue, and the
        // generic advice names ⌘R, which isn't a key there.
        manual: 'Reloading a Chrome tab can only be asked of a Mac: press Ctrl+R in the form\'s tab.'}[result?.result];
      toastMessage('Couldn\'t reload the form tab', why || osText('Press ⌘R in the form\'s tab instead.'));
    }, 'refresh'));
    if (item.kind !== 'form') actions.push(submittedButton(item));  // you pressed Submit in Chrome: say so here too (a form session's submit is seen by the extension)
    if (live) actions.push(sessionButton('Skip this role', 'secondary', () => skipSession(item)));
    else if (item.resumable) pushResume();
    const never = el('span', 'ss-never muted small');
    never.append(icon('info'), el('span', '', 'Job Pilotto never clicks Submit.'));
    actions.push(never);
  } else if (asking && !live) {
    if (item.resumable) pushResume();
    // Claude closed with the app, but the form may still be open in Chrome.
    if (item.url && !gone) actions.push(sessionButton('Open in Chrome', 'secondary', async event => {
      await openForm(item, event.currentTarget);
    }, 'link'));
    actions.push(submittedButton(item));
    actions.push(sessionButton('Remove from the list', 'secondary', () => removeSession(item)));
  } else if (asking) {
    // Continue only means something after a pause (Esc). When Claude asked for something, "Continue." gives it nothing
    // new and it asks again (a 4-hour loop on 1 Oct 2026): the main action is to answer it.
    if (/^Paused/i.test(item.note || '')) {
      actions.push(sessionButton('Continue', 'primary', () => say('Continue.')));
      actions.push(sessionButton('Answer in your own words', 'link', () => openLog(true), 'chat'));
    } else {
      actions.push(sessionButton('Answer', 'primary', () => openLog(true), 'chat'));
    }
    // The form is waiting in Chrome while Claude asks: one click to look at it, as when it works.
    if (item.url) actions.push(sessionButton('Open in Chrome', 'secondary', async event => {
      await openForm(item, event.currentTarget);
    }, 'link'));
    actions.push(submittedButton(item));
    actions.push(sessionButton('Skip this role', 'secondary', () => skipSession(item)));
  } else if (running) {
    if (item.url) actions.push(sessionButton('Open in Chrome', 'primary', async event => {
      await openForm(item, event.currentTarget);
    }, 'link'));
    actions.push(sessionButton('Pause', 'secondary', pauseSession));
    actions.push(submittedButton(item));
    actions.push(sessionButton('Watch the log', 'link', () => openLog(true), 'eye'));
  } else if (item.resumable && !submitted) {
    pushResume();
    actions.push(submittedButton(item));
  }
  // Every state with a job keeps a way to its form (owner, 8 Oct 2026: an ended session showed only Resume Claude).
  const toForm = /^(Open in Chrome|Reopen form|Open filled form)$/;
  if (item.url && !submitted && !actions.some(button => toForm.test(button.textContent))) {
    actions.splice(1, 0, sessionButton('Open in Chrome', actions.length ? 'secondary' : 'primary', async event => {
      await openForm(item, event.currentTarget);
    }, 'link'));
  }
  // One main action: with none, the way to the form is it, first in the row (a Claude button is never the orange one).
  if (!actions.some(button => button.classList.contains('primary'))) {
    const toIt = actions.find(button => toForm.test(button.textContent));
    if (toIt) { toIt.classList.replace('secondary', 'primary'); actions.splice(actions.indexOf(toIt), 1); actions.unshift(toIt); }
  }
  $('ss-actions').replaceChildren(...actions);
  // Two sections under the step: what Claude needs from you (answer, agree, confirm), then what happened
  // (what it filled, the problems it hit, its audit). Its other report sections join what happened.
  const sorted = sortChecks(checks), mine = sortChecks(forYou, {forYou: true});
  const needs = [...mine.needs, ...sorted.needs], filled = sorted.filled;
  const empty = gone ? [] : emptyFields(item, needs);   // a closed tab has no empty fields to open
  show($('ss-needs-card'), needs.length + empty.length > 0 && !gone);   // a closed tab's rows are stale: Reopen form asks what to keep
  $('ss-needs-title').textContent = 'Needs your attention';
  $('ss-needs-sub').textContent = review ? 'Most of the form is filled; a few items need your review.' : 'Left for you after the fill.';
  $('ss-needs').replaceChildren(...needs.map(need => (need.kind === 'ask' ? askRow(need, item) : needRow(need, item))), ...empty.map(label => emptyRow(label, item)));
  watchAgreements(item, needs.filter(need => need.kind === 'agree' || need.kind === 'ask'));
  applyFormStates(item);
  showFormState(item);
  updateNeedsCount();
  showOptional(item, {gone, listed: empty});   // the optional ones, folded below (session-optional.js)
  showSendBar(item);   // answers not sent yet stay with their send button when the page redraws
  // The live field list ("In the form") says what was filled, field by field: Claude's "Filled:" summary only without it.
  const listed = !!reviewStates.get(item.id)?.filled?.length;
  const happened = [
    ...done.filter(section => !(listed && /^filled$/i.test(section.label || ''))).map(section => {
      // "**Filled:**" with its details on the bullets under it: the line shows the first of them (+ how many more);
      // the list is one click away.
      const extra = !section.text && section.items.length > 1 ? ` (+${section.items.length - 1} more)` : '';
      const lead = firstLine(section.text || section.items[0] || '') + extra;
      return {short: section.label ? `**${section.label}:** ${lead}`.trim() : lead, problem: section.label === 'Problems' || PROBLEM.test(section.text),
        more: section.text ? [section.text.slice(firstLine(section.text).length).trim(), ...section.items.map(line => `- ${line}`)].filter(Boolean).join('\n')
          : section.items.length > 1 ? section.items.map(line => `- ${line}`).join('\n') : ''};
    }),
    ...filled.map(({text, problem}) => {
      const {label, text: rest} = splitLabel(text);
      const short = label || firstLine(rest);
      return {short, problem, more: label ? rest : rest.slice(short.length).trim()};
    })];
  // Problems first: they explain the rest.
  happened.sort((x, y) => Number(y.problem) - Number(x.problem));
  $('ss-happened').replaceChildren(...happened.map(({short, more, problem}) => {
    const row = foldRow(short, more);
    // A problem Claude worked around, on a form that's now ready: history, not a warning.
    if (problem) row.classList.add(formReady(item) ? 'is-solved' : 'is-problem');
    if (problem && /extension/i.test(`${short} ${more}`)) explainExtension(row);
    return row;
  }));
  show($('ss-audit-card'), !!audit);
  $('ss-audit-pill').replaceChildren();
  if (audit) {
    const capital = audit.charAt(0).toUpperCase() + audit.slice(1);
    const summary = firstLine(capital, 160), rest = capital.slice(summary.length).trim();
    const fixes = (audit.match(/\b(?:corrected|removed|fixed|by hand)\b/gi) || []).length;
    $('ss-audit-pill').replaceChildren(...(fixes ? [pill(`${fixes} correction${fixes === 1 ? '' : 's'}`, 'warn', {dot: true})] : [pill('Checked', 'good', {dot: true})]));
    $('ss-audit-summary').replaceChildren(...richText(summary).flatMap(node => [...node.childNodes]));
    $('ss-audit-detail').replaceChildren(...richText(rest));
    show($('ss-audit-more'), !!rest);
  }
  show($('ss-happened-card'), happened.length > 0 || !!audit || !!(review && item.question));
  // Claude's report, from when it finished: folded (the cards above are today's state), open while a problem it hit
  // still stands (the form isn't ready).
  $('ss-happened-when').textContent = `· ${hhmmOf(item.needsYouSince || item.endedAt || item.startedAt)}`;
  if (reportFor !== item.id) {
    reportFor = item.id;
    $('ss-happened-card').classList.toggle('is-open', happened.some(entry => entry.problem) && !formReady(item));
  }
  initOptional();
  $('ss-happened-head').onclick = event => { if (!event.target.closest('a, button')) $('ss-happened-card').classList.toggle('is-open'); };
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  setInterval(() => {
    if (document.querySelector('.view[data-view="sessions"]')?.hidden) return;
    for (const node of document.querySelectorAll('[data-since]')) node.textContent = node.dataset.prefix + sessionDuration({startedAt: node.dataset.since});
  }, 1000);
}
