// "Read the jobs on this page" (owner, 7 Oct 2026): for a site the Job Pilotto app cannot read by itself (it refuses automated visitors, or a
// portal with no API: LinkedIn, Indeed, Glassdoor), the person opens it in their own Chrome, as themselves, and clicks this. The extension
// reads the page they see, sends it to the app, goes to the next page of the same list, and stops after MAX_PAGES, when a page brings nothing
// new, or at any login wall or "are you human" check (the person deals with it, then clicks again). It never logs in, never solves a check,
// never hides that it is a script, and waits between pages. Filtering is the app's: every job read goes through the same filters and scores.
import {api, settings} from './flow.js';

export const MAX_PAGES = 20;
const PAUSE_MS = [1800, 3200];   // between pages, like a person reading: not to look like one, to be gentle with the site

// Runs inside the page (chrome.scripting): self-contained. What a person sees: the page, and each job card's visible lines.
export function extractPage() {
  const CHALLENGE = /just a moment|attention required|verify you are human|captcha|are you a robot|unusual activity|security check/i;
  const JOB = /\/jobs?\/view\/|\/jobs?\/\d|\/job\/|viewjob|[?&]jk=|\/stellen?|\/offres?[-/]|\/emplois?\/|\/vacanc|\/positions?\/|jobid=|job_id=|\/jobs\/[\w-]+-\d+/i;
  const seen = new Set();
  const cards = [];
  for (const link of document.querySelectorAll('a[href]')) {
    const href = link.href.split('#')[0];
    if (!/^https?:/.test(href) || seen.has(href) || !JOB.test(href)) continue;
    seen.add(href);
    const box = link.closest('li, article, [data-job-id], [data-occludable-job-id], [class*="job-card"], [class*="jobCard"], [class*="JobCard"], [class*="result"]') || link.parentElement;
    const lines = (box?.innerText || link.innerText || '').split('\n').map(line => line.trim()).filter(Boolean).slice(0, 8);
    const title = (link.innerText || link.getAttribute('aria-label') || lines[0] || '').split('\n').map(line => line.trim()).find(Boolean) || '';
    if (title.length >= 3) cards.push({title: title.slice(0, 160), url: href, lines});
    if (cards.length >= 300) break;
  }
  const text = `${document.title} ${(document.body?.innerText || '').slice(0, 3000)}`;
  return {
    url: location.href, title: document.title.slice(0, 300), cards,
    html: document.documentElement.outerHTML.slice(0, 3_000_000),
    challenge: CHALLENGE.test(text) && cards.length === 0,
    login: /\/(login|signin|sign-in|authwall|checkpoint|uas\/login)\b/i.test(location.pathname),
  };
}

// Runs inside the page: the next page of the same list. A "next" link or button, else the next page number, else a "more jobs" button,
// else scroll to the end (lists that load as you scroll). Returns how it went on, or 'none'.
export function goNext() {
  const visible = node => node && node.offsetParent !== null && !node.disabled && node.getAttribute('aria-disabled') !== 'true';
  const labels = node => [node.innerText, node.getAttribute('aria-label'), node.getAttribute('title')].map(text => (text || '').trim()).filter(Boolean);
  const rel = document.querySelector('a[rel="next"], link[rel="next"]');
  if (rel?.href && rel.tagName === 'A' && visible(rel)) { rel.click(); return 'next link'; }
  const NEXT = /^(next|suivant|weiter|nächste|siguiente|successivo|›|»|>)$|next page|page suivante|nächste seite/i;
  const controls = [...document.querySelectorAll('a, button, [role="button"]')].filter(visible);
  const next = controls.find(node => labels(node).some(text => NEXT.test(text)));
  if (next) { next.click(); return 'next button'; }
  const current = document.querySelector('[aria-current="page"], [aria-current="true"], .active > a, li.selected');
  const number = Number((current?.innerText || '').trim());
  if (number) {
    const following = controls.find(node => (node.innerText || '').trim() === String(number + 1));
    if (following) { following.click(); return 'page number'; }
  }
  const more = controls.find(node => labels(node).some(text => /^(see more jobs|show more|load more|more jobs|afficher plus|plus d'offres|mehr anzeigen|weitere jobs)/i.test(text)));
  if (more) { more.click(); return 'more button'; }
  const before = document.documentElement.scrollHeight;
  window.scrollTo(0, before);
  return before > window.innerHeight + 50 ? 'scroll' : 'none';
}

const wait = ms => new Promise(done => setTimeout(done, ms));
const pause = () => wait(PAUSE_MS[0] + Math.random() * (PAUSE_MS[1] - PAUSE_MS[0]));
const badge = (tabId, text, title) => {
  chrome.action.setBadgeText({tabId, text}).catch(() => {});   // the tab may already be closed
  if (title) chrome.action.setTitle({tabId, title}).catch(() => {});
};
const run = async (tabId, func) => (await chrome.scripting.executeScript({target: {tabId}, func}))[0]?.result;

// The whole visit, from the person's click: pages read, jobs the app kept, and why it stopped. Progress on the toolbar icon and in session
// storage (the popup shows it while open).
export async function readSite(tabId, {pages = MAX_PAGES} = {}) {
  const session = `${tabId}-${Date.now()}`;
  const config = await settings();
  const state = {pages: 0, jobs: 0, added: 0, name: '', stopped: ''};
  const say = () => chrome.storage.session.set({[`visit:${tabId}`]: {...state, at: Date.now()}});
  try {
    for (let page = 0; page < pages; page++) {
      const seen = await run(tabId, extractPage);
      if (!seen) { state.stopped = 'the page could not be read'; break; }
      if (seen.login || seen.challenge) { state.stopped = seen.login ? 'the site asks you to sign in: do it, then click again' : 'the site shows a check: answer it yourself, then click again'; break; }
      const answer = await api(config, '/extension/visit-read', {method: 'POST', body: JSON.stringify({session, url: seen.url, title: seen.title, html: seen.html, cards: seen.cards})});
      if (!answer?.ok) { state.stopped = answer?.error || 'the app did not take the page'; break; }
      Object.assign(state, {pages: page + 1, jobs: answer.jobs, added: state.added + (answer.added || 0), name: answer.name});
      badge(tabId, String(state.pages), `Job Pilotto: reading ${answer.name}, page ${state.pages}: ${answer.jobs} jobs so far`);
      await say();
      if (page > 0 && !answer.added) { state.stopped = 'no new jobs on this page: the end of the list'; break; }
      const how = await run(tabId, goNext);
      if (how === 'none') { state.stopped = 'no next page'; break; }
      await pause();
      if (how !== 'scroll') await waitForPage(tabId);
    }
    if (!state.stopped) state.stopped = `${pages} pages read: the most at once`;
  } catch (error) {
    state.stopped = /Cannot access|permission/i.test(error.message) ? 'the next page is on another site, or access was not given' : (error.message || 'stopped');
  }
  badge(tabId, state.jobs ? '✓' : '!', `Job Pilotto: ${state.jobs} jobs read from ${state.name || 'this site'} (${state.stopped})`);
  await say();
  return state;
}

// A page that changed by navigation or by script: wait until it says complete, at most 8 s, then a moment for its list to draw.
async function waitForPage(tabId) {
  for (let waited = 0; waited < 8000; waited += 400) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error('the tab was closed');
    if (tab.status === 'complete' && waited >= 800) break;
    await wait(400);
  }
  await wait(900);
}

// Sites on the app's visit list light the toolbar icon (the badge needs no access to the page). Asked of the app at most every 10 minutes.
let hosts = {at: 0, list: []};
export async function markListed(tabId, url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return; }
  if (Date.now() - hosts.at > 600000) {
    try { hosts = {at: Date.now(), list: (await api(await settings(), '/extension/visit-list', {method: 'POST', body: '{}'}))?.hosts || []}; } catch { hosts.at = Date.now(); }
  }
  if (hosts.list.some(listed => host === listed || host.endsWith(`.${listed}`) || (listed.endsWith('.') && host.includes(listed)))) {
    badge(tabId, 'Read', 'Job Pilotto: a site only you can open. Click, then "Read the jobs on this page"');
  }
}
