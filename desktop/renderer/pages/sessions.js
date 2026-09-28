// Application sessions: the dock, the list, the next step.
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {avatar} from '../jobs-view.js';
import {PROBLEM, latestStep, readSessionMessage, sortChecks, splitLabel} from '../session-message.js';
import {asksYou, firstLine, isLive, sessionDuration, sessionReview, sessionState} from '../session-state.js';
import {shared} from './shared.js';
import {$, show} from './core.js';
import {pageKey, renderJobs} from './jobs.js';
import {richText} from './rich-text.js';
import {attachTerminal, fitTerminal, openSession, renderSessionPage, say} from './session-log.js';
import {applyFormStates, askRow, emptyFields, emptyRow, explainExtension, needRow, showFormState, updateNeedsCount, watchAgreements} from './session-needs.js';
import {toastMessage} from './startup.js';

// Other pages import these from here.
export {firstLine, isLive, sessionDuration, sessionReview, sessionState};
export const SESSION_PILL = {running: {label: 'Applying', tone: 'info'}, input: {label: 'Needs input', tone: 'warn'}, done: {label: 'Form filled', tone: 'good'}};
export let sessionList = [], logChoice = {};

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
export async function refreshSessions() {
  sessionList = await window.pilot.sessions().catch(() => []);
  renderDock();
  if (!document.querySelector('.view[data-view="sessions"]').hidden) renderSessionPage();
}
export function sessionLogo(item) {
  const {initials, hue} = avatar(sessionCompany(item));
  const badge = el('span', 'logo', initials);
  badge.style.setProperty('--hue', hue);
  return badge;
}
export function renderDock() {
  const live = sessionList.filter(item => !item.endedAt || item.status === 'done');
  // Not on the sessions page itself (it lists them all): the tray would only repeat what's on screen.
  const onSessionsPage = !document.querySelector('.view[data-view="sessions"]')?.hidden;
  show($('sessions-dock'), sessionList.length > 0 && !onSessionsPage);
  if (!sessionList.length) return;
  const running = sessionList.filter(isLive).length, waiting = sessionList.filter(item => item.status === 'input').length;
  // Two pills: how many are active (blue), how many wait for you (amber).
  $('sd-summary').replaceChildren(pill(`${running} active`, 'info'), ...(waiting ? [pill(`${waiting} need${waiting === 1 ? 's' : ''} input`, 'warn')] : []));
  $('sd-toggle').setAttribute('aria-expanded', shared.dockOpen);
  $('sessions-dock').classList.toggle('is-closed', !shared.dockOpen);
  const order = {input: 0, running: 1, done: 2, failed: 3, ended: 4};
  const shown = [...(live.length ? live : sessionList)].sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5)).slice(0, 3);
  $('sd-cards').replaceChildren(...shown.map(item => {
    const [label, tone] = sessionState(item);
    const card = el('div', `sd-card tone-${tone}`);
    const words = el('div', 'sd-words');
    const title = el('b', 'focus-headline', `${sessionCompany(item)} · ${sessionTitle(item)}`);
    title.title = title.textContent;
    const state = el('div', 'sd-state');  // the badge, then what it's doing (or asking), on one line under the title
    const note = el('span', 'muted small sd-note', item.status === 'input' ? item.brief || item.note || '' : item.note || '');
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
  const menu = [{label: '↗ Open posting', run: () => window.pilot.openExternal(item.url)}];
  if (isLive(item)) menu.push({label: '⏸ Pause Claude (Esc)', run: () => pauseSession()});
  if (item.resumable) menu.push({label: '▶ Resume Claude', run: () => resumeSession(item)});
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
// Removing a session whose job is still Applying asks whether it was submitted (Applied, or back to Kit ready), so
// a job never stays stuck as Applying; any other job's session just goes.
export async function removeSession(item) {
  if (sessionJob(item).stage === 'Applying') {
    const result = await window.pilot.sessionFinish(item.id);
    if (result?.cancelled) return;
    if (!result?.ok) { toastMessage('Not removed', result?.error || 'Notion could not be updated. Try again.'); return; }
    const job = sessionJob(item);
    job.stage = result.submitted ? 'Applied' : 'Kit ready';
    if (result.submitted) job.status = 'applied';
  } else await window.pilot.sessionRemove(item.id);
  if (shared.openSessionId === item.id) shared.openSessionId = null;
  await refreshSessions();
  if (!document.querySelector('.view[data-view="jobs"]').hidden) renderJobs();
}
// Close: Claude stops (if it runs), then the session goes; a job still Applying asks "Did you submit?" first.
async function closeSession(item) {
  if (isLive(item)) await window.pilot.sessionStop(item.id);
  await removeSession(item);
}
// Cancel: Claude stops, the form tab closes, the job goes back to Kit ready, the session goes (asked once).
export async function cancelSession(item) {
  const result = await window.pilot.sessionCancel(item.id);
  if (result?.cancelled) return;
  if (!result?.ok) { toastMessage('Not cancelled', result?.error || 'Try again.'); await refreshSessions(); return; }
  const job = sessionJob(item);
  if (job.stage === 'Applying') job.stage = 'Kit ready';
  if (!result.closed) toastMessage('Application cancelled', 'The job is back to Kit ready. Its form tab wasn\'t found: close it in Chrome yourself.');
  if (shared.openSessionId === item.id) shared.openSessionId = null;
  await refreshSessions();
  if (!document.querySelector('.view[data-view="jobs"]').hidden) renderJobs();
}
// Start again: this session closes and a new one starts on the same job (asked once, in a dialog).
export async function restartSession(item) {
  const result = await window.pilot.sessionRestart(item.id);
  if (result?.cancelled) return;
  if (!result?.ok) { toastMessage('Not started again', result?.error || 'Try again.'); await refreshSessions(); return; }
  await refreshSessions();
  if (result.session?.id) openSession(result.session.id);
}
// Claude again, in this session's conversation (the app was closed, or the session stopped). The log opens to show it.
export async function resumeSession(item) {
  const result = await window.pilot.sessionResume(item.id);
  if (!result?.ok) { toastMessage('Not resumed', result?.error || 'Claude could not be started.'); return; }
  logChoice[item.id] = true;
  shared.termShownFor = null;
  await refreshSessions();
}
function pauseSession() { if (shared.openSessionId) window.pilot.sessionWrite(shared.openSessionId, '\x1b'); }  // Esc interrupts Claude
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
  line.append(icon('chevron'), ...richText(short).flatMap(node => [...node.childNodes]));
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
let fullFor = null;  // the session whose Claude's message the banner shows (folded again for another one)
export function renderNextStep(item) {
  const review = sessionReview(item), asking = item.status === 'input' && !review, running = item.status === 'running';
  const {checks, needs: forYou, audit, done, intro} = readSessionMessage(item.question);
  const tone = review || asking ? 'warn' : running ? 'info' : item.status === 'failed' ? 'bad' : 'neutral';
  $('ss-decision').className = `ss-next tone-${tone}`;
  const brief = item.brief || '';
  const ask = asksYou(item) && /\?$/.test(brief) ? brief : '';
  $('ss-next-title').textContent = review ? 'Review the filled application'
    : asking ? ask || 'Claude needs your answer'
    : running ? 'Claude is filling the application' : item.status === 'failed' ? 'The session stopped' : 'The session ended';
  // Its state, after the title: finished (when), waiting (since when) or working (for how long).
  const since = item.needsYouSince || item.endedAt || item.startedAt;
  const state = $('ss-next-state');
  state.textContent = review ? `· Claude finished at ${hhmmOf(since)}` : asking ? (isLive(item) ? `· waiting since ${hhmmOf(since)}` : '· Claude closed with the app')
    : running ? '· working' : `· ended at ${hhmmOf(since)}`;
  if (running) ticking(state, '· working for ', item.startedAt); else { delete state.dataset.since; delete state.dataset.prefix; }
  // What to read: one line when the form is ready (Claude's words one click away), else Claude's own text.
  const said = intro.filter(line => line.replace(/\*/g, '') !== ask);
  $('ss-question').replaceChildren(...(review ? [el('p', 'rich-p', 'Check the answers and legal boxes in Chrome, then submit it yourself.')]
    : asking ? richText(said.join('\n'))
    : [Object.assign(el('p', 'rich-p muted', (running && latestStep(sessionTail[item.id] || '')) || item.note || ''), {id: running ? 'ss-step' : ''})]));
  const full = $('ss-full');
  full.replaceChildren(...(review && item.question ? richText(item.question) : []));
  if (fullFor !== item.id) { full.hidden = true; fullFor = item.id; }
  const actions = [], live = isLive(item);
  const resume = kind => sessionButton('Resume Claude', kind, () => resumeSession(item), 'refresh');
  if (review) {
    actions.push(sessionButton('Open filled form', 'primary', async () => {
      const went = await window.pilot.showBrowser(item.url, sessionCompany(item), item.id);
      if (went === 'chrome') toastMessage('Form tab not found', 'No open form answered. Look for the tab Claude used in Chrome.');
    }, 'link'));
    if (live) actions.push(sessionButton('Skip this role', 'secondary', () => say('Skip this role: close its tab and finish without filling anything.')));
    else if (item.resumable) actions.push(resume('secondary'));
    if (item.question) {
      const toggle = sessionButton(full.hidden ? 'Claude\'s message ▾' : 'Claude\'s message ▴', 'link', () => {
        full.hidden = !full.hidden;
        toggle.querySelector('span').textContent = full.hidden ? 'Claude\'s message ▾' : 'Claude\'s message ▴';
      });
      actions.push(toggle);
    }
    const never = el('span', 'ss-never muted small');
    never.append(icon('info'), el('span', '', 'Job Pilotto never clicks Submit.'));
    actions.push(never);
  } else if (asking && !live) {
    if (item.resumable) actions.push(resume('primary'));
    actions.push(sessionButton('Remove from the list', 'secondary', () => removeSession(item)));
  } else if (asking) {
    actions.push(sessionButton('Continue', 'primary', () => say('Continue.')));
    actions.push(sessionButton('Skip this role', 'secondary', () => say('Skip this role: close its tab and finish without filling anything.')));
    actions.push(sessionButton('Answer in your own words', 'link', () => openLog(true), 'chat'));
  } else if (running) {
    actions.push(sessionButton('Pause', 'secondary', pauseSession));
    actions.push(sessionButton('Watch the log', 'link', () => openLog(true), 'eye'));
  } else if (item.resumable) {
    actions.push(resume('primary'));
  }
  $('ss-actions').replaceChildren(...actions);
  // Two sections under the step: what Claude needs from you (answer, agree, confirm), then what happened
  // (what it filled, the problems it hit, its audit). Its other report sections join what happened.
  const sorted = sortChecks(checks), mine = sortChecks(forYou, {forYou: true});
  const needs = [...mine.needs, ...sorted.needs], filled = sorted.filled;
  const empty = emptyFields(item, needs);
  show($('ss-needs-card'), needs.length + empty.length > 0);
  $('ss-needs-title').textContent = review ? 'What Claude needs from you' : 'What Claude flagged';
  $('ss-needs').replaceChildren(...needs.map(need => (need.kind === 'ask' ? askRow(need, item) : needRow(need, item))), ...empty.map(label => emptyRow(label, item)));
  watchAgreements(item, needs.filter(need => need.kind === 'agree'));
  applyFormStates(item);
  showFormState(item);
  updateNeedsCount();
  const happened = [
    ...done.map(section => {
      const lead = firstLine(section.text);
      return {short: section.label ? `**${section.label}:** ${lead}`.trim() : lead, problem: section.label === 'Problems' || PROBLEM.test(section.text),
        more: [section.text.slice(lead.length).trim(), ...section.items.map(line => `- ${line}`)].filter(Boolean).join('\n')};
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
    if (problem) row.classList.add('is-problem');
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
  show($('ss-happened-card'), happened.length > 0 || !!audit);
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  setInterval(() => {
    if (document.querySelector('.view[data-view="sessions"]')?.hidden) return;
    for (const node of document.querySelectorAll('[data-since]')) node.textContent = node.dataset.prefix + sessionDuration({startedAt: node.dataset.since});
  }, 1000);
}
