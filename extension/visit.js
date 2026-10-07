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

// Runs inside the page: a compact outline for Claude when no recipe or quick guess reads the list (owner, 7 Oct 2026: "intelligent enough to
// adapt on any website"). Job cards are repeated blocks on any site: groups of 3+ siblings with the same tag and class, each with a CSS path
// and a few samples (their text lines and links); plus the controls that look like paging. Never form values; text capped.
export function pageOutline() {
  // A block's lines: its visible text pieces in order (inline spans are separate lines; innerText would join them).
  const linesOf = node => {
    const out = [];
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const text = walk.currentNode.textContent.replace(/\s+/g, ' ').trim();
      const parent = walk.currentNode.parentElement;
      if (text && parent && (parent.offsetParent !== null || parent.getClientRects().length > 0) && out.at(-1) !== text) out.push(text);
    }
    return out;
  };
  const visible = node => node.offsetParent !== null || node.getClientRects().length > 0;
  const path = node => {
    const parts = [];
    for (let at = node; at && at !== document.body && parts.length < 6; at = at.parentElement) {
      const cls = [...at.classList].filter(c => /^[a-zA-Z][\w-]{1,40}$/.test(c) && !/\d{3,}/.test(c)).slice(0, 2).map(c => `.${CSS.escape(c)}`).join('');
      parts.unshift(`${at.tagName.toLowerCase()}${cls}`);
    }
    return parts.join(' > ');
  };
  const signature = node => `${node.tagName}.${[...node.classList].filter(c => !/\d{3,}/.test(c)).sort().join('.')}`;
  const groups = [];
  const seen = new Set();
  for (const parent of document.querySelectorAll('body *')) {
    if (groups.length >= 12) break;
    const kids = [...parent.children].filter(visible);
    if (kids.length < 3) continue;
    const counts = {};
    for (const kid of kids) counts[signature(kid)] = (counts[signature(kid)] || 0) + 1;
    const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (n < 3) continue;
    const items = kids.filter(kid => signature(kid) === best && (kid.innerText || '').trim().length > 8 && kid.querySelector('a[href]'));
    if (items.length < 3) continue;
    const selector = path(items[0]);
    if (seen.has(selector)) continue;
    seen.add(selector);
    groups.push({id: `g${groups.length + 1}`, selector, count: document.querySelectorAll(selector).length,
      samples: items.slice(0, 3).map(item => ({lines: linesOf(item).slice(0, 8).map(line => line.slice(0, 100)),
        links: [...item.querySelectorAll('a[href]')].slice(0, 3).map(link => ({text: (link.innerText || '').trim().slice(0, 80), href: link.getAttribute('href').slice(0, 160)}))}))});
  }
  const pager = [];
  for (const node of document.querySelectorAll('a[href], button, [role=button]')) {
    const label = (node.getAttribute('aria-label') || node.innerText || node.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
    if (!label || label.length > 30 || !visible(node)) continue;
    if (!/^\d{1,3}$|next|suiv|weiter|nächst|sigu|succ|more|plus|mehr|›|»|>|→/i.test(label)) continue;
    pager.push({label, kind: node.tagName === 'A' ? 'link' : 'button'});
    if (pager.length >= 25) break;
  }
  return {url: location.href, title: document.title.slice(0, 200), groups, pager};
}

// Runs inside the page: the jobs a recipe (from Claude, saved per site) reads: each block matching recipe.selector, its job link, and the
// lines it names for title, employer and place.
export function cardsByRecipe(recipe) {
  // A block's lines: its visible text pieces in order (inline spans are separate lines; innerText would join them).
  const linesOf = node => {
    const out = [];
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const text = walk.currentNode.textContent.replace(/\s+/g, ' ').trim();
      const parent = walk.currentNode.parentElement;
      if (text && parent && (parent.offsetParent !== null || parent.getClientRects().length > 0) && out.at(-1) !== text) out.push(text);
    }
    return out;
  };
  const cards = [];
  const seen = new Set();
  for (const item of document.querySelectorAll(recipe.selector)) {
    const lines = linesOf(item);
    const links = [...item.querySelectorAll('a[href]')];
    const link = links[Math.min(recipe.link || 0, links.length - 1)] || item.closest('a[href]');
    if (!link) continue;
    const href = link.href.split('#')[0];
    const title = (recipe.title >= 0 ? lines[recipe.title] : link.innerText) || '';
    if (!title || seen.has(href)) continue;
    seen.add(href);
    const pick = index => (index >= 0 && lines[index] && lines[index] !== title ? lines[index] : '');
    cards.push({title: title.slice(0, 160), url: href, lines: [title, pick(recipe.company), pick(recipe.place)].filter(Boolean)});
    if (cards.length >= 300) break;
  }
  return cards;
}

// Runs inside the page: the next page by a recipe's paging: a control with that exact label, the page number after the current one, or scroll.
export function nextByRecipe(recipe) {
  const visible = node => node && (node.offsetParent !== null || node.getClientRects().length > 0) && !node.disabled && node.getAttribute('aria-disabled') !== 'true';
  const labels = node => [node.getAttribute('aria-label'), node.innerText, node.getAttribute('title')].map(text => (text || '').replace(/\s+/g, ' ').trim());
  const controls = [...document.querySelectorAll('a[href], button, [role=button]')].filter(visible);
  if (recipe.next === 'scroll') { const before = document.documentElement.scrollHeight; window.scrollTo(0, before); return before > window.innerHeight + 50 ? 'scroll' : 'none'; }
  if (recipe.next === 'number') {
    const current = document.querySelector('[aria-current="page"], [aria-current="true"]');
    const number = Number((current?.innerText || '').trim());
    const following = number && controls.find(node => (node.innerText || '').trim() === String(number + 1));
    if (following) { following.click(); return 'page number'; }
    return 'none';
  }
  const target = controls.find(node => labels(node).includes(recipe.next));
  if (target) { target.click(); return 'recipe'; }
  return 'none';
}

// Runs inside the page: a small banner while the extension reads it (owner: "otherwise a loading spinner/banner"), or none (text '').
export function pageBanner(text) {
  let node = document.getElementById('jobpilotto-reading');
  if (!text) { node?.remove(); return; }
  if (!node) {
    node = document.createElement('div');
    node.id = 'jobpilotto-reading';
    node.setAttribute('role', 'status');
    node.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;padding:10px 14px;border-radius:10px;background:#132439;color:#fff;'
      + 'font:600 13px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);pointer-events:none';
    document.documentElement.append(node);
  }
  node.textContent = text;
}

// Runs inside the page: its filter controls, for Claude to choose from (the app's src/ai/visit_filters.py). Labels and options only, never the
// page's other text. Each gets a data-jp-control id so the chosen steps find it again. Anything that applies, signs in, messages, saves,
// follows, pays or leaves the site is never listed (and applyFilters refuses it again).
export function collectControls() {
  const NEVER = /apply|postuler|bewerb|candidat|submit|envoyer|sign ?in|sign ?up|log ?in|connexion|anmeld|register|message|connect|follow|save|enregistr|speicher|alert|premium|upgrade|buy|subscribe|abonn|share|partager|report|delete|easy apply|candidature simplifi/i;
  const visible = node => node.offsetParent !== null || node.getClientRects().length > 0;
  const labelOf = node => (node.getAttribute('aria-label') || (node.id && document.querySelector(`label[for="${CSS.escape(node.id)}"]`)?.innerText)
    || node.closest('label')?.innerText || node.innerText || node.getAttribute('placeholder') || node.getAttribute('title') || node.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const out = [];
  const nodes = document.querySelectorAll('select, input[type=checkbox], input[type=radio], input[type=text], input[type=search], input:not([type]), '
    + 'button[aria-expanded], button[aria-haspopup], button[aria-pressed], [role=checkbox], [role=radio], [role=switch], [role=option], [role=menuitemcheckbox], [role=menuitemradio]');
  for (const node of nodes) {
    if (!visible(node) || node.disabled) continue;
    const label = labelOf(node);
    if (!label || NEVER.test(label) || node.closest('form[action*="login"], form[action*="apply"]')) continue;
    const id = node.dataset.jpControl || `c${out.length + 1}`;
    node.dataset.jpControl = id;
    const kind = node.tagName === 'SELECT' ? 'select' : node.tagName === 'INPUT' ? (['checkbox', 'radio'].includes(node.type) ? node.type : 'text') : (node.getAttribute('role') || 'button');
    out.push({id, kind, label, options: node.tagName === 'SELECT' ? [...node.options].map(option => option.text.trim()).slice(0, 12) : [],
      on: !!(node.checked || node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-pressed') === 'true' || node.getAttribute('aria-selected') === 'true')});
    if (out.length >= 60) break;   // a short list: Claude answers in seconds (LinkedIn's 150 took 130 s, 7 Oct 2026)
  }
  return out;
}

// Runs inside the page: the steps Claude chose, on the controls listed above only, refusing again anything that applies, signs in or leaves.
export function applyFilters(steps) {
  const NEVER = /apply|postuler|bewerb|candidat|submit|envoyer|sign ?in|sign ?up|log ?in|connexion|anmeld|register|message|connect|follow|save|enregistr|speicher|alert|premium|upgrade|buy|subscribe|abonn|share|partager|report|delete|easy apply|candidature simplifi/i;
  const done = [];
  for (const step of steps || []) {
    const node = document.querySelector(`[data-jp-control="${CSS.escape(String(step.control))}"]`);
    const label = node ? (node.getAttribute('aria-label') || node.innerText || node.getAttribute('placeholder') || '').trim() : '';
    if (!node || NEVER.test(label) || (node.tagName === 'A' && node.host && node.host !== location.host)) { done.push({control: step.control, ok: false}); continue; }
    if (step.action === 'select' && node.tagName === 'SELECT') {
      const option = [...node.options].find(item => item.text.trim() === step.value);
      if (!option) { done.push({control: step.control, ok: false}); continue; }
      node.value = option.value;
      node.dispatchEvent(new Event('change', {bubbles: true}));
    } else if (step.action === 'type' && node.tagName === 'INPUT') {
      node.focus();
      node.value = step.value;
      node.dispatchEvent(new Event('input', {bubbles: true}));
      node.dispatchEvent(new Event('change', {bubbles: true}));
      node.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
      node.form?.requestSubmit?.();
    } else {
      node.click();
    }
    done.push({control: step.control, ok: true});
  }
  return done;
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

// The quick guess is kept only when it clearly looks like a job list; otherwise Claude reads the page's outline.
export function plausible(cards) {
  const titles = (cards || []).map(card => String(card.title || '').trim()).filter(Boolean);
  if (titles.length < 3 || new Set(titles).size < 3) return false;
  const sorted = titles.map(title => title.length).sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)];
  return middle >= 8 && middle <= 100 && titles.filter(title => /^\d+$|^(next|more|see all|apply)/i.test(title)).length < titles.length / 3;
}

const wait = ms => new Promise(done => setTimeout(done, ms));
const pause = () => wait(PAUSE_MS[0] + Math.random() * (PAUSE_MS[1] - PAUSE_MS[0]));
const badge = (tabId, text, title) => {
  chrome.action.setBadgeText({tabId, text}).catch(() => {});   // the tab may already be closed
  if (title) chrome.action.setTitle({tabId, title}).catch(() => {});
};
const run = async (tabId, func, args = []) => (await chrome.scripting.executeScript({target: {tabId}, func, args}))[0]?.result;
export const FILTER_ROUNDS = 3;   // filter panels open more filters: look again, at most this often

// Claude chooses the page's filters for this person's search (through the app), the steps are applied with a pause between rounds.
async function setFilters(tabId, config, state) {
  for (let round = 0; round < FILTER_ROUNDS; round++) {
    const controls = await run(tabId, collectControls);
    if (!controls?.length) break;
    const tab = await chrome.tabs.get(tabId);
    const plan = await api(config, '/extension/visit-filters', {method: 'POST', body: JSON.stringify({url: tab.url, title: tab.title, controls, ticket: state.ticket})}).catch(error => ({ok: false, error: error.message}));
    if (!plan?.ok) { state.note = plan?.error || 'filters not set'; break; }   // said in the popup; the page is read as it is
    if (!plan.steps?.length) break;
    const done = await run(tabId, applyFilters, [plan.steps]);
    state.filters.push(...plan.steps.filter((step, i) => done?.[i]?.ok).map(step => `${step.label}${step.value ? `: ${step.value}` : ''}`));
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

async function readSiteAwake(tabId, {pages, filter, ticket = ''}) {
  const session = `${tabId}-${Date.now()}`;
  const config = await settings();
  const state = {pages: 0, jobs: 0, added: 0, name: '', stopped: '', filters: [], learned: false, ticket};
  const say = () => chrome.storage.session.set({[`visit:${tabId}`]: {...state, at: Date.now()}});
  try {
    if (filter) {
      await run(tabId, pageBanner, ['Job Pilotto: Claude is choosing the filters for your search…']).catch(() => {});
      await setFilters(tabId, config, state).catch(() => { /* filters are a help: the page is read as it is */ });
    }
    // How to read this site: its saved recipe (no AI), else the quick guess, else Claude from the page's outline (once per visit).
    const start = (await chrome.tabs.get(tabId)).url;
    let recipe = (await api(config, '/extension/visit-recipe', {method: 'POST', body: JSON.stringify({url: start})}).catch(() => null))?.recipe || null;
    let asked = false;
    const learn = async () => {
      asked = true;
      const outline = await run(tabId, pageOutline);
      const answer = await api(config, '/extension/visit-understand', {method: 'POST', body: JSON.stringify(outline)}).catch(() => null);
      if (answer?.recipe) { recipe = answer.recipe; state.learned = true; }
      return !!answer?.recipe;
    };
    for (let page = 0; page < pages; page++) {
      await run(tabId, pageBanner, [`Job Pilotto is reading this page${page ? ` · page ${page + 1}` : ''}…`]).catch(() => {});
      const seen = await run(tabId, extractPage);
      if (!seen) { state.stopped = 'the page could not be read'; break; }
      if (seen.login || seen.challenge) { state.stopped = seen.login ? 'the site asks you to sign in: do it, then click again' : 'the site shows a check: answer it yourself, then click again'; break; }
      let cards = recipe ? await run(tabId, cardsByRecipe, [recipe]) : seen.cards;
      if (recipe && !cards.length && page === 0) {   // a recipe that no longer fits this site: forgotten, read afresh
        await api(config, '/extension/visit-recipe', {method: 'POST', body: JSON.stringify({url: seen.url, forget: true})}).catch(() => {});
        recipe = null;
        cards = seen.cards;
      }
      if (!recipe && !plausible(cards) && !asked && await learn()) cards = await run(tabId, cardsByRecipe, [recipe]);
      const answer = await api(config, '/extension/visit-read', {method: 'POST', body: JSON.stringify({session, ticket: state.ticket, url: seen.url, title: seen.title, html: seen.html, cards})});
      if (!answer?.ok) { state.stopped = answer?.error || 'the app did not take the page'; break; }
      Object.assign(state, {pages: page + 1, jobs: answer.jobs, added: state.added + (answer.added || 0), name: answer.name});
      badge(tabId, String(state.pages), `Job Pilotto: reading ${answer.name}, page ${state.pages}: ${answer.jobs} jobs so far`);
      await say();
      if (page > 0 && !answer.added) { state.stopped = 'no new jobs on this page: the end of the list'; break; }
      let how = recipe ? await run(tabId, nextByRecipe, [recipe]) : await run(tabId, goNext);
      if (how === 'none' && !recipe && !asked && await learn() && recipe.next !== 'none') how = await run(tabId, nextByRecipe, [recipe]);
      if (how === 'none') { state.stopped = 'no next page'; break; }
      await pause();
      if (how !== 'scroll') await waitForPage(tabId);
    }
    if (!state.stopped) state.stopped = `${pages} pages read: the most at once`;
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

// Tabs the app opened for "Read sites only you can open" (Actions): marked #jp-read (or #jp-read-filter), read by themselves once the person
// has allowed the extension on the sites the app opens (Chrome's own prompt, once, from the popup). Each reports to the app and closes, so the
// app can open the next. Only marked tabs: any other page still needs the person's click.
export const MARKS = {'#jp-read': false, '#jp-read-filter': true};
// A mark may carry the app's id for the tab (#jp-read-filter-a1b2c3): reported back, so a site that redirects (www.glassdoor.com to
// de.glassdoor.ch, 7 Oct 2026) is still matched to the run that opened it.
export const MARK = /#(jp-read(-filter)?)(?:-([a-z0-9]{4,16}))?$/;
export const ALL_SITES = {origins: ['https://*/*']};   // as declared in manifest.json; asking or checking more is always refused
const started = new Set();
export async function autoRead(tabId, url) {
  const found = MARK.exec(String(url));
  if (!found || started.has(tabId)) return;
  const mark = found[0], filter = !!found[2], ticket = found[3] || '';
  if (!(await chrome.permissions.contains(ALL_SITES))) {
    // Waiting on the person (owner, 7 Oct 2026: "if there is an action from my side and it's blocking, show it"): the extension's own
    // page with the Allow button opens beside the site (once), and the app is told, so its banner says "waiting for you", not "reading".
    await chrome.storage.session.set({[`waiting:${tabId}`]: url});
    badge(tabId, '!', 'Job Pilotto: waiting for you: press Allow on the page it opened');
    const asked = (await chrome.storage.session.get('allowTab')).allowTab;
    if (!asked || !(await chrome.tabs.get(asked).catch(() => null))) {
      const tab = await chrome.tabs.create({url: chrome.runtime.getURL('allow.html'), active: true}).catch(() => null);
      if (tab) await chrome.storage.session.set({allowTab: tab.id});
    }
    await api(await settings(), '/extension/visit-waiting', {method: 'POST', body: JSON.stringify({url: url.slice(0, -mark.length), ticket, why: 'allow'})}).catch(() => {});
    return;
  }
  started.add(tabId);
  const start = url.slice(0, -mark.length);
  const state = await readSite(tabId, {filter, ticket}).catch(error => ({stopped: error.message, jobs: 0, pages: 0}));
  await api(await settings(), '/extension/visit-done', {method: 'POST', body: JSON.stringify({url: start, ticket, ...state})}).catch(() => {});
  started.delete(tabId);
  await chrome.tabs.remove(tabId).catch(() => {});   // done: the app opens the next site in its place
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
