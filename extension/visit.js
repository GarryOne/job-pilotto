// "Read the jobs on this page" (owner, 7 Oct 2026): for a site the Job Pilotto app cannot read by itself (it refuses automated visitors, or a
// portal with no API: LinkedIn, Indeed, Glassdoor), the person opens it in their own Chrome, as themselves, and clicks this. The extension
// reads the page they see, sends it to the app, goes to the next page of the same list, and stops after MAX_PAGES, when a page brings nothing
// new, or at any login wall or "are you human" check (the person deals with it, then clicks again). It never logs in, never solves a check,
// never hides that it is a script, and waits between pages. Filtering is the app's: every job read goes through the same filters and scores.
import {api, settings} from './flow.js';
import {ALL_SITES, openAllowPage} from './site-allow.js';

export const MAX_PAGES = 20;
const PAUSE_MS = [1800, 3200];   // between pages, like a person reading: not to look like one, to be gentle with the site

import {extractPage, pageOutline, cardsByRecipe, nextByRecipe, closeConsent, pageBanner, collectControls, jobFrame, collectWays, applyFilters, goNext, plausible} from './visit-page.js';
export {extractPage, pageOutline, cardsByRecipe, nextByRecipe, closeConsent, pageBanner, collectControls, jobFrame, collectWays, applyFilters, goNext, plausible};
// (the functions that run inside the page are in visit-page.js; the visit itself is here)


const wait = ms => new Promise(done => setTimeout(done, ms));
const pause = () => wait(PAUSE_MS[0] + Math.random() * (PAUSE_MS[1] - PAUSE_MS[0]));
const badge = (tabId, text, title) => {
  chrome.action.setBadgeText({tabId, text}).catch(() => {});   // the tab may already be closed
  if (title) chrome.action.setTitle({tabId, title}).catch(() => {});
};
const run = async (tabId, func, args = []) => (await chrome.scripting.executeScript({target: {tabId}, func, args}))[0]?.result;
// The cookie closer in every frame of the tab: a consent message drawn in an iframe is out of the page's own reach. The first label pressed.
const inFrames = async (tabId, args = []) => (await chrome.scripting.executeScript({target: {tabId, allFrames: true}, func: closeConsent, args}).catch(() => []))
  .map(frame => frame?.result);
// Its words first (free); a banner in another language: the app picks, from the banner's own buttons, the one that refuses what is not
// necessary, else the one that accepts (desktop/lib/server-pages.js pickChoice, by meaning, kept), and that one is pressed.
const closeConsentEverywhere = async tabId => {
  const pressed = (await inFrames(tabId)).find(Boolean);
  if (pressed) return pressed;
  const buttons = [...new Set((await inFrames(tabId, [{list: true}])).flatMap(found => (Array.isArray(found) ? found : [])))].slice(0, 20);
  if (!buttons.length) return '';
  const config = await settings().catch(() => null);
  for (const value of ['Reject all cookies that are not necessary', 'Accept cookies']) {
    const choice = config && (await api(config, '/extension/pick-choice', {method: 'POST', body: JSON.stringify({label: 'A cookie banner', value, options: buttons})}).catch(() => null))?.choice;
    if (choice) return (await inFrames(tabId, [{press: choice}])).find(Boolean) || '';
  }
  return '';
};
// Template code where an address should be (DHL, 7 Oct 2026: careers.dhl.com/global/${getUrl(linkEle,): never a place to go.
const TEMPLATE = /\$\{|\{\{|%7B/i;
export const FILTER_ROUNDS = 3;
export const UNBLOCK_TRIES = 2;   // a page with no job list: at most this many times Claude picks a way on, then the site says why it stopped   // filter panels open more filters: look again, at most this often

// Claude chooses the page's filters for this person's search (through the app), the steps are applied with a pause between rounds.
async function setFilters(tabId, config, state) {
  const tried = new Set();   // control|value: a step already taken is never taken again (8 Oct 2026: "geneva" typed into Decathlon's box three rounds running)
  for (let round = 0; round < FILTER_ROUNDS; round++) {
    const controls = await run(tabId, collectControls);
    if (!controls?.length) break;
    const tab = await chrome.tabs.get(tabId);
    const plan = await api(config, '/extension/visit-filters', {method: 'POST', body: JSON.stringify({url: tab.url, title: tab.title, controls, ticket: state.ticket})}).catch(error => ({ok: false, error: error.message}));
    if (!plan?.ok) { state.note = plan?.error || 'filters not set'; break; }   // said in the popup; the page is read as it is
    const fresh = (plan.steps || []).filter(step => !tried.has(`${step.label}|${step.value}`));
    if (!fresh.length) break;
    for (const step of fresh) tried.add(`${step.label}|${step.value}`);
    plan.steps = fresh;
    const done = await run(tabId, applyFilters, [plan.steps]);
    // The place the list is now filtered to (the engine keeps only place steps, src/ai/visit_filters.py): a picked suggestion, a chosen option,
    // a clicked choice, a search typed and sent; never a suggest box's text that matched nothing. Jobs on its cards with no place of their own
    // are in that place (src/sources/visits.py read).
    for (const [step, result] of plan.steps.map((step, i) => [step, done?.[i]])) {
      if (result?.ok && (!result.suggests || result.picked)) state.place = String(result.picked || step.value || step.label || '').slice(0, 80);
    }
    // Said in the site's row (and so the run log): whether a suggest box's place was really picked, or only typed and so filtered nothing.
    state.filters.push(...plan.steps.map((step, i) => [step, done?.[i]]).filter(([, result]) => result?.ok).map(([step, result]) => `${step.label}${step.value ? `: ${step.value}` : ''}`
      + (result.suggests ? (result.picked ? ` (picked "${result.picked}")` : ' (typed, but no suggestion matched: not filtered)') : '')));
    badge(tabId, 'F', `Job Pilotto: filters for your search: ${state.filters.join(', ')}`);
    await chrome.storage.session.set({[`visit:${tabId}`]: {...state, at: Date.now()}});
    await pause();
    await waitForPage(tabId).catch(() => {});
  }
}

// The whole visit, from the person's click: pages read, jobs the app kept, and why it stopped. Progress on the toolbar icon and in session
// storage (the popup shows it while open).
export async function readSite(tabId, {pages = MAX_PAGES, filter = false, ticket = ''} = {}) {
  // Chrome stops an extension's worker that looks idle (7 Oct 2026: two reads died right after Claude's filter answer, the app waited on
  // nothing): a light call every 20 s while reading keeps it awake, and each page tells the app it is still alive.
  const awake = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
  try { return await readSiteAwake(tabId, {pages, filter, ticket}); } finally { clearInterval(awake); }
}

// A site the app opened gets one minute of reading (owner, 7 Oct 2026: "a timeout of 30-60 s per website"); the jobs read by then are kept.
export const SITE_MS = 60 * 1000;
// What this tab is doing, in the same words twice: the banner on the page, and the app's row for the site (Recent activity, a tab the app opened).
export async function tellStep(tabId, config, ticket, words, runIn = run, send = api) {
  await runIn(tabId, pageBanner, [words ? `Job Pilotto: ${words}` : '']).catch(() => {});
  if (ticket && words) await send(config, '/extension/visit-state', {method: 'POST', body: JSON.stringify({ticket, words})}).catch(() => {});
}
async function readSiteAwake(tabId, {pages, filter, ticket = ''}) {
  const deadline = ticket ? Date.now() + SITE_MS : Infinity;
  let thought = 0;   // Claude's time (job list, filters, learning the page): not counted against the minute, as in the app
  const thinking = async work => { const began = Date.now(); try { return await work(); } finally { thought += Date.now() - began; } };
  const consent = async () => {   // a cookie banner in the way: closed, and said
    const pressed = await closeConsentEverywhere(tabId);
    if (pressed) { state.consent = pressed; await tellStep(tabId, config, ticket, `closed the cookie banner ("${pressed.slice(0, 40)}")`); await wait(800); }
  };
  const session = `${tabId}-${Date.now()}`;
  const config = await settings();
  const state = {pages: 0, jobs: 0, added: 0, name: '', stopped: '', filters: [], learned: false, ticket};
  const say = () => chrome.storage.session.set({[`visit:${tabId}`]: {...state, at: Date.now()}});
  try {
    // Not a job list (a home page, an "about" page): go to the site's job list first, as a person would, then filter and read there.
    await consent();
    let first = await run(tabId, extractPage).catch(() => null);
    if (first?.blank) {   // a page that draws nothing: a few seconds more, then loaded once again, then said and stopped (not skipped as silent)
      await tellStep(tabId, config, ticket, 'the page is still blank: waiting a few seconds…');
      await wait(5000);
      first = await run(tabId, extractPage).catch(() => null);
      if (first?.blank) {
        await tellStep(tabId, config, ticket, 'still blank: loading it again…');
        await chrome.tabs.reload(tabId);
        await waitForPage(tabId).catch(() => {});
        await wait(3000);
        first = await run(tabId, extractPage).catch(() => null);
      }
      if (first?.blank) throw new Error('the page stayed blank, even loaded again: open it yourself once (it may want you to sign in), then Open again');
    }
    if (first && !first.login && !first.challenge && !plausible(first.cards)) {
      await tellStep(tabId, config, ticket, 'looking for this site\'s job list…');
      const found = await thinking(() => api(config, '/extension/visit-jobpage', {method: 'POST', body: JSON.stringify({url: first.url, html: first.html, ticket})}).catch(() => null));
      if (found?.url && found.url.split('#')[0] !== first.url.split('#')[0]) {
        state.jobpage = found.url;
        await tellStep(tabId, config, ticket, `going to its job list: ${found.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}`);
        await chrome.tabs.update(tabId, {url: found.url});
        await pause();
        await waitForPage(tabId).catch(() => {});
        await consent();
      }
    }
    if (filter) {
      await tellStep(tabId, config, ticket, 'Claude is choosing the filters for your search…');
      await thinking(() => setFilters(tabId, config, state).catch(() => { /* filters are a help: the page is read as it is */ }));
      await tellStep(tabId, config, ticket, state.filters.length ? `filters set: ${state.filters.join(', ').slice(0, 100)}` : `no filters set${state.note ? ` (${state.note})` : ''}: reading the page as it is`);
    }
    // How to read this site: its saved recipe (no AI), else the quick guess, else Claude from the page's outline (once per visit).
    const start = (await chrome.tabs.get(tabId)).url;
    let recipe = (await api(config, '/extension/visit-recipe', {method: 'POST', body: JSON.stringify({url: start})}).catch(() => null))?.recipe || null;
    let asked = false, unstuck = 0;
    // This site's own job list, by its learned layout, showing no jobs (a list filtered to your places that has none): no way on to look for,
    // and not a wrong job page (7 Oct 2026: Claude looked for "a way to the jobs" on an empty brand page, one AI call each).
    let knownList = false;
    let framed = false;   // a job list inside a frame was looked for (once a visit)
    const learn = async () => {
      asked = true;
      await tellStep(tabId, config, ticket, 'Claude is learning how to read this site (once)…');
      const outline = await run(tabId, pageOutline);
      const answer = await thinking(() => api(config, '/extension/visit-understand', {method: 'POST', body: JSON.stringify({...outline, ticket})}).catch(() => null));
      if (answer?.recipe) { recipe = answer.recipe; state.learned = true; }
      return !!answer?.recipe;
    };
    let away = 0;   // pages in a row with no job in your places
    for (let page = 0; page < pages; page++) {
      if (Date.now() - thought > deadline) { state.stopped = `${SITE_MS / 1000} s are up after ${state.pages} page${state.pages === 1 ? '' : 's'}: the rest of the list was not read`; break; }
      await tellStep(tabId, config, ticket, `reading page ${page + 1}…`);
      const seen = await run(tabId, extractPage);
      if (!seen) { state.stopped = 'the page could not be read'; break; }
      if (seen.login || seen.challenge) { state.stopped = seen.login ? 'the site asks you to sign in: do it, then click again' : 'the site shows a check: answer it yourself, then click again'; break; }
      let cards = recipe ? await run(tabId, cardsByRecipe, [recipe]) : seen.cards;
      if (recipe && !cards.length && page === 0) {
        if (plausible(seen.cards)) {   // the quick guess reads a list the recipe misses: it no longer fits this site, forgotten and read afresh
          await api(config, '/extension/visit-recipe', {method: 'POST', body: JSON.stringify({url: seen.url, forget: true})}).catch(() => {});
          recipe = null;
          cards = seen.cards;
        } else {   // no list by either: maybe this page has no jobs (a brand filtered to your place). Kept, and not learned again for it, until
          // it misses twice in a row (7 Oct 2026: Richemont's layout was forgotten on one brand and learned again on the next, the same).
          const kept = await api(config, '/extension/visit-recipe', {method: 'POST', body: JSON.stringify({url: seen.url, missed: true})}).catch(() => null);
          if (kept?.forgot) { recipe = null; cards = seen.cards; } else { asked = true; knownList = true; }
        }
      }
      if (!recipe && !plausible(cards) && !asked && await learn()) cards = await run(tabId, cardsByRecipe, [recipe]);
      if (!cards?.length && page === 0 && !framed) {   // the list drawn by another site inside this page (Manor's by live.solique.ch): opened itself
        framed = true;
        const frame = await run(tabId, jobFrame).catch(() => '');
        if (frame) {
          await tellStep(tabId, config, ticket, `its job list is in a frame from ${new URL(frame).host}: opening it`);
          await chrome.tabs.update(tabId, {url: frame});
          await pause();
          await waitForPage(tabId).catch(() => {});
          await consent();
          if (filter) {   // the filters set before were the outer page's: this list has its own (Manor's, in live.solique.ch)
            await tellStep(tabId, config, ticket, 'Claude is choosing the filters for your search…');
            await thinking(() => setFilters(tabId, config, state).catch(() => {}));
          }
          recipe = null; asked = false;
          page -= 1;
          continue;
        }
      }
      if (!cards?.length && page === 0 && unstuck < UNBLOCK_TRIES && !knownList) {   // no jobs here yet: Claude picks a way to them (owner: "ask Claude how to get unblocked")
        unstuck += 1;
        await tellStep(tabId, config, ticket, 'no jobs on this page yet: Claude is looking for the way to them…');
        const page0 = await run(tabId, collectWays).catch(() => null);
        const way = page0 && await thinking(() => api(config, '/extension/visit-unblock', {method: 'POST', body: JSON.stringify({...page0, ticket})}).catch(() => null));
        if (way?.needs_person) { state.stopped = `the site needs you: ${way.needs_person}`; break; }
        if (way?.steps?.length) {
          for (const step of way.steps) {
            if (step.action === 'open') { if (/^https:\/\//.test(step.href || '') && !TEMPLATE.test(step.href)) await chrome.tabs.update(tabId, {url: step.href}); }
            else await run(tabId, applyFilters, [[step]]).catch(() => null);
          }
          await tellStep(tabId, config, ticket, `Claude: ${String(way.why || 'trying a way to the jobs').slice(0, 120)}`);
          await pause();
          await waitForPage(tabId).catch(() => {});
          await consent();
          recipe = null; asked = false;
          page -= 1;   // the same page number again, on what the steps showed
          continue;
        }
      }
      if (!cards?.length) {   // why nothing was read, said in the site's row: what the page showed, so "0 jobs" is never a mystery
        const banner = await closeConsentEverywhere(tabId);
        if (banner) state.consent = banner;
        await tellStep(tabId, config, ticket, knownList ? 'its job list shows no jobs here (filtered to your places, it may have none)'
          : `no job cards on this page (${seen.cards?.length || 0} repeated items seen${asked ? ', none of them jobs by Claude\'s reading' : ''}${banner ? `; a cookie banner was still open, closed with "${banner.slice(0, 30)}"` : ''})`);
      }
      const answer = await api(config, '/extension/visit-read', {method: 'POST', body: JSON.stringify({session, ticket: state.ticket, url: seen.url, title: seen.title, html: seen.html, cards, knownList, place: state.place || ''})});
      if (!answer?.ok) { state.stopped = answer?.error || 'the app did not take the page'; break; }
      Object.assign(state, {pages: page + 1, jobs: answer.jobs, added: state.added + (answer.added || 0), name: answer.name});
      badge(tabId, String(state.pages), `Job Pilotto: reading ${answer.name}, page ${state.pages}: ${answer.jobs} jobs so far`);
      await say();
      if (page > 0 && !answer.added) { state.stopped = 'no new jobs on this page: the end of the list'; break; }
      // Two pages in a row whose jobs are all elsewhere (their places say so): the rest of a worldwide list is elsewhere too (7 Oct 2026: Chanel,
      // 9 pages and 180 jobs worldwide, 0 in Geneva). A page whose cards show no place never counts.
      away = answer.placed > 0 && answer.in_places === 0 ? away + 1 : 0;
      if (away >= 2) { state.stopped = 'two pages in a row with no job in your places: the rest of this list is elsewhere'; break; }
      let how = recipe ? await run(tabId, nextByRecipe, [recipe]) : await run(tabId, goNext);
      if (how === 'none' && !recipe && !asked && await learn() && recipe.next !== 'none') how = await run(tabId, nextByRecipe, [recipe]);
      if (how === 'none') { state.stopped = 'no next page'; break; }
      await tellStep(tabId, config, ticket, how === 'scroll' ? 'scrolling for more jobs…' : `going to page ${page + 2}…`);
      await pause();
      if (how !== 'scroll') await waitForPage(tabId);
    }
    if (!state.stopped) state.stopped = `${pages} pages read: the most at once`;
    // Nothing read at all: not "the end of the list" (there was none), said as what it is (owner's run, 7 Oct 2026).
    // A list that has none in your places today is read, not failed (owner, 8 Oct 2026: Jaeger-LeCoultre's Geneva list was a red ✗ with "Read with Claude").
    if (!state.jobs && /end of the list|no next page/.test(state.stopped) && (knownList || state.place)) state.empty = true;
    if (!state.jobs && /end of the list|no next page/.test(state.stopped)) state.stopped = knownList ? 'its job list has no jobs here today (filtered to your places)'
      : state.filters.some(filter => !/not filtered/.test(filter)) ? `no jobs on this list with your place filter (${state.filters.join(', ').slice(0, 80)})`
      : 'no job list found on this page: try Read with Claude, or Open it myself';
  } catch (error) {
    state.stopped = /Cannot access|permission/i.test(error.message) ? 'the next page is on another site, or access was not given' : (error.message || 'stopped');
  }
  await run(tabId, pageBanner, ['']).catch(() => {});
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

// Runs inside the page: a job posting's main text (the page's <main> or <article>, else its body), or why it cannot be read: a sign-in page
// (a sign-in address, or a password box on a short page) or a bot check. Text only, never the page's markup.
export function postingText() {
  const CHALLENGE = /just a moment|attention required|verify you are human|captcha|are you a robot|unusual activity|security check/i;
  const body = (document.body?.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const main = [...document.querySelectorAll('main, article, [role=main]')].map(node => node.innerText.trim()).sort((a, b) => b.length - a.length)[0] || '';
  const text = (main.length >= 200 ? main : body).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
  const login = /\/(login|signin|sign-in|authwall|checkpoint|uas\/login)\b/i.test(location.pathname) || (!!document.querySelector('input[type=password]') && body.length < 1500);
  const check = !login && CHALLENGE.test(body.slice(0, 2000)) && body.length < 3000;
  return {url: location.href.split('#')[0], title: document.title.slice(0, 300), text: login || check ? '' : text, blocked: login ? 'login' : check ? 'check' : ''};
}
async function readPosting(tabId, ticket) {
  const config = await settings();
  await tellStep(tabId, config, ticket, 'reading the posting…');
  await waitForPage(tabId).catch(() => {});
  await closeConsentEverywhere(tabId);
  let page = await run(tabId, postingText);
  if (page && !page.blocked && page.text.length < 200) { await wait(3000); page = await run(tabId, postingText) || page; }   // drawn late by its scripts
  if (!page) throw new Error('the page could not be read');
  const answer = await api(config, '/extension/posting', {method: 'POST', body: JSON.stringify({ticket, ...page})}).catch(() => null);
  await tellStep(tabId, config, ticket, page.blocked ? `the posting is behind a ${page.blocked === 'login' ? 'sign-in' : 'check'}: open it yourself`
    : answer?.saved ? 'the posting\'s text was saved' : 'too little text on this page to be a posting');
}

// Tabs the app opened for "Read sites only you can open" (Actions): marked #jp-read (or #jp-read-filter), read by themselves once the person
// has allowed the extension on the sites the app opens (Chrome's own prompt, once, from the popup). Each reports to the app and closes, so the
// app can open the next. Only marked tabs: any other page still needs the person's click.
export const MARKS = {'#jp-read': false, '#jp-read-filter': true};
// A tab the app opened to read one job posting (#jp-posting-<ticket>): a job whose text the engine could not fetch (a sign-in site, a site that
// refuses it, a page drawn by scripts). Its main text is sent once; nothing is clicked, filled or followed.
export const POSTING_MARK = /#jp-posting-([a-z0-9]{4,16})$/;
// A mark may carry the app's id for the tab (#jp-read-filter-a1b2c3): reported back, so a site that redirects (www.glassdoor.com to
// de.glassdoor.ch, 7 Oct 2026) is still matched to the run that opened it.
export const MARK = /#(jp-read(-filter)?)(?:-([a-z0-9]{4,16}))?$/;
export {ALL_SITES};   // site-allow.js: as declared in manifest.json; asking or checking more is always refused
const started = new Set();
// Sites this worker is reading now: an update of the extension waits for them (a reload ends every reading; 7 Oct 2026: two runs lost their sites).
export const readingNow = () => started.size;
export async function autoRead(tabId, url) {
  const posting = POSTING_MARK.exec(String(url));
  const found = posting || MARK.exec(String(url));
  if (!found || started.has(tabId)) return;
  started.add(tabId);   // at once: the page-ready and page-complete events can both arrive while the next line waits
  const mark = found[0], filter = !posting && !!found[2], ticket = (posting ? found[1] : found[3]) || '';
  if (!(await chrome.permissions.contains(ALL_SITES))) {
    started.delete(tabId);   // waiting for Allow: the next load of this tab tries again
    // Waiting on the person (owner, 7 Oct 2026: "if there is an action from my side and it's blocking, show it"): the extension's own
    // page with the Allow button opens beside the site (once), and the app is told, so its banner says "waiting for you", not "reading".
    await chrome.storage.session.set({[`waiting:${tabId}`]: url});
    badge(tabId, '!', 'Job Pilotto: waiting for you: press Allow on the page it opened');
    await openAllowPage();   // site-allow.js: the same page an apply tab waits on
    await api(await settings(), '/extension/visit-waiting', {method: 'POST', body: JSON.stringify({url: url.slice(0, -mark.length), ticket, why: 'allow'})}).catch(() => {});
    return;
  }
  const start = url.slice(0, -mark.length);
  if (posting) {   // one job posting whose text only a browser can read ("Jobs we couldn't read"): its text goes to the app, nothing else
    await readPosting(tabId, ticket).catch(() => {});
  } else {
    const state = await readSite(tabId, {filter, ticket}).catch(error => ({stopped: error.message, jobs: 0, pages: 0}));
    await api(await settings(), '/extension/visit-done', {method: 'POST', body: JSON.stringify({url: start, ticket, ...state})}).catch(() => {});
  }
  started.delete(tabId);
  await chrome.storage.session.remove(`readmark:${tabId}`).catch(() => {});
  await chrome.tabs.remove(tabId).catch(() => {});   // done: the app opens the next site in its place
}
// A tab the app opened to read whose site could not be reached at all (no such address, no answer, a bad certificate): said at once, not
// after 30 s of silence (7 Oct 2026: www.geneva-freeport.ch does not exist, and the run waited for a page that never loaded).
const UNREACHABLE = {NAME_NOT_RESOLVED: 'no such address', NAME_RESOLUTION_FAILED: 'no such address', CONNECTION_REFUSED: 'it refused the connection',
  CONNECTION_TIMED_OUT: 'it did not answer', TIMED_OUT: 'it did not answer', ADDRESS_UNREACHABLE: 'it did not answer', CONNECTION_RESET: 'it dropped the connection',
  SSL_PROTOCOL_ERROR: 'its secure connection failed', CERT_COMMON_NAME_INVALID: 'its security certificate is not valid', CERT_DATE_INVALID: 'its security certificate is not valid',
  CERT_AUTHORITY_INVALID: 'its security certificate is not valid'};
export function unreachableWhy(error) {
  const code = String(error || '').replace(/^net::ERR_/, '');
  return UNREACHABLE[code] || '';
}
export async function siteUnreachable(tabId, url, error) {
  const found = MARK.exec(String(url));
  const why = unreachableWhy(error);
  if (!found || !why || started.has(tabId)) return;   // a reading in progress says it itself; an aborted load (a redirect) is not an error
  const ticket = found[3] || '';
  await api(await settings(), '/extension/visit-done', {method: 'POST', body: JSON.stringify({url: url.slice(0, -found[0].length), ticket, jobs: 0, pages: 0,
    stopped: `the site could not be reached: ${why} (${String(error).replace(/^net::/, '')})`})}).catch(() => {});
  await chrome.storage.session.remove(`readmark:${tabId}`).catch(() => {});
  await chrome.tabs.remove(tabId).catch(() => {});
}
// Allowed from the popup: the tabs that were waiting start now.
export async function startWaiting() {
  const all = await chrome.storage.session.get(null);
  if (all.allowTab) { chrome.tabs.remove(all.allowTab).catch(() => {}); await chrome.storage.session.remove('allowTab'); }
  for (const [key, url] of Object.entries(all)) {
    if (!key.startsWith('waiting:')) continue;
    await chrome.storage.session.remove(key);
    autoRead(Number(key.slice(8)), url);
  }
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
