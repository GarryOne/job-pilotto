// Jobs → a job's drawer (owner's boards, 10 Oct 2026): a right-side overlay over the unchanged list or board, between the title bar and the
// bottom bars, with a fixed header (ring, title, previous / next, expand, close), the eight tabs (Overview, Match, Description, Application,
// Interviews, Review, Messages, Timeline) and the tab's content scrolling on its own. The page is read from the store (IPC jobPage,
// lib/job-page-handlers.js), so it is the same on every store. It shares one overlay slot with Recent activity (renderer/overlay-slot.js):
// opening one closes the other, and a job opened from a run says "Back to Recent activity". Opening it never resizes the list.
// Parts: job-drawer/ (header, tabs, parts, one file per tab). Pure words: renderer/job-page-view.js. Guards: test/job-drawer.test.js,
// test/job-panel.test.js, test/job-page-view.test.js.
import {el} from '../components.js';
import {pageParts, tabKey, TABS} from '../job-page-view.js';
import {claimOverlay, registerOverlay, releaseOverlay, reopenOverlay} from '../overlay-slot.js';
import {drawerHeader} from '../job-drawer/header.js';
import {button, skeleton, stateCard} from '../job-drawer/parts.js';
import {BODIES} from '../job-drawer/tabs-body.js';
import {tabStrip} from '../job-drawer/tabs.js';
import {$} from './core.js';
import {shared} from './shared.js';

const state = {url: '', job: null, page: null, tab: 'overview', tabs: new Map(), expanded: false, asked: 0, back: null};
export const panelUrl = () => state.url;

// The jobs on screen, in order (the list's rows or the board's cards): what previous / next walk through.
const shownUrls = () => [...document.querySelectorAll(`${$('jobs-board').hidden ? '#jobs-body .job-row' : '#jobs-board .board-card'}[data-url]`)]
  .map(node => node.dataset.url).filter(Boolean);

function neighbour(step) {
  const urls = shownUrls(), at = urls.indexOf(state.url) + step;
  const url = urls[at];
  return url && (shared.allJobs || []).find(job => job.url === url);
}

function footer(job, page) {
  const bar = el('footer', 'jd-foot');
  bar.append(button('Open posting ↗', () => window.pilot.openExternal(job.url)));
  if (page?.links && job.notion_url) bar.append(button('Open in Notion ↗', event => window.pilot.openNotion(job.notion_url, event.metaKey)));
  return bar;
}

function pick(key) {
  state.tab = key;
  state.tabs.set(state.url, key);
  draw();
}

function draw() {
  const {job, page} = state, panel = $('job-panel');
  const urls = shownUrls(), index = urls.indexOf(state.url);
  const head = drawerHeader(job, page, {
    at: index < 0 ? null : {index, total: urls.length}, expanded: state.expanded,
    back: state.back && {label: state.back.label, run: goBack},
    on: {prev: () => go(-1), next: () => go(1), interviews: () => pick('interviews'), expand: () => { state.expanded = !state.expanded; draw(); }, close: closeJobPanel},
  });
  panel.classList.toggle('is-expanded', state.expanded);
  const tabs = tabStrip(TABS, state.tab, pick);
  const body = el('div', 'jd-body');
  if (!page) body.append(...skeleton());
  else if (page.error) {
    body.append(stateCard({icon: 'alert', tone: 'bad', title: 'Could not read this job', text: page.error,
      actions: [button('Retry', () => load(job))]}));   // Retry only after a failure
  } else body.append(...BODIES[state.tab]({job, page, parts: pageParts(page)}));
  panel.replaceChildren(head, tabs, body, footer(job, page));
  panel.setAttribute('aria-label', `${job.title}, job details`);
}

function go(step) {
  const next = neighbour(step);
  if (next) openJobPanel(next);
}

async function load(job) {
  state.page = null;
  draw();
  const asked = ++state.asked;
  const page = await window.pilot.jobPage(job.url).catch(error => ({error: error.message}));
  if (asked === state.asked && state.url === job.url) { state.page = page; draw(); }   // a later click wins
}

// Opens (or switches) the drawer on a job; `tab` picks a tab (a kit chip opens Application, the score ring's "Open full details" Match);
// the same job keeps the tab it was on.
export async function openJobPanel(job, tab = '') {
  const displaced = claimOverlay('job');
  if (displaced) state.back = {name: displaced, label: displaced === 'activity' ? 'Recent activity' : displaced};
  else if (!state.url) state.back = null;
  state.job = job;
  state.url = job.url;
  state.tab = tab ? tabKey(tab) : state.tabs.get(job.url) || 'overview';
  $('job-drawer-layer').hidden = false;
  for (const row of document.querySelectorAll('.job-row, .board-card')) row.classList.toggle('is-selected', row.dataset.url === job.url);
  await load(job);
}

export function closeJobPanel() {
  if (!state.url) return;
  state.url = '';
  state.asked++;
  releaseOverlay('job');
  $('job-drawer-layer').hidden = true;
  for (const row of document.querySelectorAll('.job-row.is-selected, .board-card.is-selected')) row.classList.remove('is-selected');
}

function goBack() {
  const name = state.back?.name;
  closeJobPanel();
  state.back = null;
  if (name) reopenOverlay(name);
}

registerOverlay('job', {close: closeJobPanel, open: () => state.job && openJobPanel(state.job)});
$('job-drawer-backdrop').addEventListener('click', closeJobPanel);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.url && !event.defaultPrevented) closeJobPanel(); });
