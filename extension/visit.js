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
    blank: (document.body?.innerText || '').trim().length < 40,   // nothing drawn yet (7 Oct 2026: LinkedIn stayed white)
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
// A cookie or consent banner over the page (owner, 7 Oct 2026: "the extension doesn't know to accept cookies"; Omega's 6 jobs sat behind one):
// closed the way a person would, choosing the least consent offered: "reject all" / "technical or necessary only" first, "accept" only when it
// is the one way on. Only a box that speaks of cookies or consent, never one with a password field. Runs in the page; returns the label pressed.
export function closeConsent() {
  const visible = node => { const box = node.getBoundingClientRect(); const look = getComputedStyle(node); return box.width > 0 && box.height > 0 && look.visibility !== 'hidden' && look.display !== 'none'; };
  const words = node => (node.innerText || node.value || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  const ABOUT = /cookie|consent|gdpr|privacy|datenschutz|confidentialit|traceurs|tracking/i;
  // Inside a frame that is itself the consent message (Sourcepoint, TrustArc draw theirs in an iframe), the whole frame is the box.
  const framed = window !== window.top && ABOUT.test(document.body?.innerText || '') && !document.querySelector('input[type=password]') ? [document.body] : [];
  const boxes = [...framed, ...document.querySelectorAll('[role=dialog], [aria-modal=true], dialog, [id*=cookie i], [class*=cookie i], [id*=consent i], [class*=consent i], [id*=onetrust i], [id*=didomi i], [id*=cmp i], [class*=cmp i]')]
    .filter(node => visible(node) && ABOUT.test(node.innerText || '') && !node.querySelector('input[type=password]'));
  const least = /^(reject|decline|refuse|deny|necessary|essential|only necessary|use necessary|allow (technical|necessary|essential)|tout refuser|refuser|continuer sans accepter|nur (notwendige|erforderliche|technisch)|ablehnen|alle ablehnen|rifiuta|solo (necessari|tecnici))/i;
  const any = /^(accept|agree|allow all|got it|ok\b|okay|i understand|accepter|tout accepter|j'accepte|akzeptieren|alle akzeptieren|zustimmen|einverstanden|accetta|accetto)/i;
  for (const pattern of [least, any]) {
    for (const box of boxes) {
      const button = [...box.querySelectorAll('button, a, [role=button], input[type=button], input[type=submit]')].find(node => visible(node) && pattern.test(words(node)) && words(node).length < 60);
      if (button) { button.click(); return words(button); }
    }
  }
  return '';
}

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
    // A page-wide number: a second round (or the way-finder after it) never gives one id to two elements (7 Oct 2026: on Fust "w5" named
    // two links, and "Occasionen" was clicked for "Zu den offenen Stellen").
    const root = document.documentElement;
    const id = node.dataset.jpControl || `c${root.dataset.jpNext = Number(root.dataset.jpNext || 0) + 1}`;
    node.dataset.jpControl = id;
    const kind = node.tagName === 'SELECT' ? 'select' : node.tagName === 'INPUT' ? (['checkbox', 'radio'].includes(node.type) ? node.type : 'text') : (node.getAttribute('role') || 'button');
    out.push({id, kind, label, options: node.tagName === 'SELECT' ? [...node.options].map(option => option.text.trim()).slice(0, 12) : [],
      on: !!(node.checked || node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-pressed') === 'true' || node.getAttribute('aria-selected') === 'true')});
    if (out.length >= 60) break;   // a short list: Claude answers in seconds (LinkedIn's 150 took 130 s, 7 Oct 2026)
  }
  return out;
}

// Runs inside the page: its ways on when it shows no job list (buttons, links, search boxes, choices), for Claude to pick a way to the jobs
// (src/ai/visit_unblock.py), with the title and first lines of text. Nothing that applies, signs in, saves or pays is ever listed.
export function collectWays() {
  const NEVER = /apply|postuler|bewerb|candidat|submit|envoyer|sign ?in|sign ?up|log ?in|connexion|anmeld|register|message|connect|follow|save|enregistr|speicher|alert|premium|upgrade|buy|subscribe|abonn|share|partager|report|delete|easy apply|candidature simplifi|password|checkout|cart|panier|warenkorb/i;
  const visible = node => (node.offsetParent !== null || node.getClientRects().length > 0) && getComputedStyle(node).visibility !== 'hidden';
  const labelOf = node => (node.getAttribute('aria-label') || node.innerText || node.value || node.getAttribute('placeholder') || node.getAttribute('title') || node.name || '')
    .replace(/\s+/g, ' ').trim().slice(0, 120);
  const ways = [];
  for (const node of document.querySelectorAll('a[href], button, [role=button], input[type=search], input[type=text], input:not([type]), select')) {
    if (!visible(node) || node.disabled) continue;
    const label = labelOf(node);
    const href = node.tagName === 'A' ? node.href.split('#')[0] : '';
    // An address that is a page's template code, not a link (7 Oct 2026: DHL's "${getUrl(linkEle,"), is never offered.
    if ((!label && !href) || NEVER.test(label) || /^(mailto|tel|javascript):|\$\{|\{\{|%7B/i.test(node.getAttribute('href') || '') || node.closest('form[action*="login"], form[action*="apply"]')) continue;
    if (href && ways.some(way => way.href === href)) continue;
    const root = document.documentElement;   // a page-wide number, as in collectControls: ids stay unique across rounds
    const id = node.dataset.jpControl || `w${root.dataset.jpNext = Number(root.dataset.jpNext || 0) + 1}`;
    node.dataset.jpControl = id;
    const kind = node.tagName === 'A' ? 'link' : node.tagName === 'SELECT' ? 'select' : node.tagName === 'INPUT' ? 'search box' : 'button';
    ways.push({id, kind, label, href, options: node.tagName === 'SELECT' ? [...node.options].map(option => option.text.trim()).slice(0, 15) : []});
    if (ways.length >= 120) break;
  }
  return {url: location.href, title: document.title.slice(0, 200), text: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 800), ways};
}

// Runs inside the page: the steps Claude chose, on the controls listed above only, refusing again anything that applies, signs in or leaves.
export async function applyFilters(steps) {
  const NEVER = /apply|postuler|bewerb|candidat|submit|envoyer|sign ?in|sign ?up|log ?in|connexion|anmeld|register|message|connect|follow|save|enregistr|speicher|alert|premium|upgrade|buy|subscribe|abonn|share|partager|report|delete|easy apply|candidature simplifi/i;
  // A box that suggests as you type (Tom Select, select2, an ARIA combobox) filters only once a suggestion is picked: typed text alone is
  // just its search (7 Oct 2026: Van Cleef's "Location = Geneva" was typed three times and 220 jobs worldwide were read; picked, 6).
  const plain = text => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const suggests = node => node.getAttribute('role') === 'combobox' || node.hasAttribute('aria-autocomplete') || node.hasAttribute('aria-controls');
  // A plain box may draw its own suggestions too (a home-made list under it): any box a place is typed into is watched for them, but only for
  // suggestions that appeared after the typing, so a link already on the page that names the place is never clicked.
  const OPTIONS = '[role=option], [role=listbox] li, .ts-dropdown .option, .select2-results__option, .ui-menu-item, .autocomplete-suggestion, '
    + '[class*=suggest] li, [class*=suggest] a, [class*=autocomplete] li, [class*=autocomplete] a';
  const shown = root => [...root.querySelectorAll(OPTIONS)]
    .filter(option => (option.offsetParent !== null || option.getClientRects().length > 0) && option.getAttribute('aria-disabled') !== 'true');
  const pickSuggestion = async (node, value, before, waitMs) => {
    const want = plain(value);
    for (let waited = 0; waited < waitMs; waited += 200) {   // suggestions often come after a pause or from the server
      await new Promise(done => setTimeout(done, 200));
      const list = document.getElementById(node.getAttribute('aria-controls') || node.getAttribute('aria-owns') || '');
      const options = shown(list || document).filter(option => !before.has(option) && plain(option.innerText || option.textContent));
      const text = item => plain(item.innerText || item.textContent);
      const option = options.find(item => text(item) === want) || options.find(item => text(item).startsWith(want)) || options.find(item => text(item).includes(want));
      if (option) {
        for (const type of ['mousedown', 'mouseup', 'click']) option.dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true}));
        return (option.innerText || option.textContent).replace(/\s+/g, ' ').trim().slice(0, 80);
      }
    }
    return '';
  };
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
      const declared = suggests(node), before = new Set(shown(document));
      node.focus();
      node.value = step.value;
      node.dispatchEvent(new Event('input', {bubbles: true}));
      // The suggestion first, then the search: an Enter or submit before it sends the form without the place. A declared suggest box waits
      // up to 3 s; a plain one 1.6 s, and with no suggestion it is searched as typed (Enter), as before.
      const picked = await pickSuggestion(node, step.value, before, declared ? 3000 : 1600);
      if (declared || picked) {
        done.push({control: step.control, ok: true, picked, suggests: true});
        node.form?.requestSubmit?.();
        continue;
      }
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
  const visible = node => node && node.offsetParent !== null && !node.disabled && node.getAttribute('aria-disabled') !== 'true'
    && !/\$\{|\{\{|%7B/i.test(node.getAttribute('href') || '');   // a link to template code (DHL's "${getUrl(") goes nowhere
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
// The cookie closer in every frame of the tab: a consent message drawn in an iframe is out of the page's own reach. The first label pressed.
const closeConsentEverywhere = async tabId => ((await chrome.scripting.executeScript({target: {tabId, allFrames: true}, func: closeConsent}).catch(() => []))
  .map(frame => frame?.result).find(Boolean) || '');
// Template code where an address should be (DHL, 7 Oct 2026: careers.dhl.com/global/${getUrl(linkEle,): never a place to go.
const TEMPLATE = /\$\{|\{\{|%7B/i;
export const FILTER_ROUNDS = 3;
export const UNBLOCK_TRIES = 2;   // a page with no job list: at most this many times Claude picks a way on, then the site says why it stopped   // filter panels open more filters: look again, at most this often

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
      const answer = await api(config, '/extension/visit-read', {method: 'POST', body: JSON.stringify({session, ticket: state.ticket, url: seen.url, title: seen.title, html: seen.html, cards, knownList})});
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
    if (!state.jobs && /end of the list|no next page/.test(state.stopped)) state.stopped = knownList ? 'its job list has no jobs here today (filtered to your places)'
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
export const ALL_SITES = {origins: ['https://*/*']};   // as declared in manifest.json; asking or checking more is always refused
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
    const asked = (await chrome.storage.session.get('allowTab')).allowTab;
    if (!asked || !(await chrome.tabs.get(asked).catch(() => null))) {
      const tab = await chrome.tabs.create({url: chrome.runtime.getURL('allow.html'), active: true}).catch(() => null);
      if (tab) await chrome.storage.session.set({allowTab: tab.id});
    }
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
