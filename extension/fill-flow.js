// The fill flow (moved out of background.js, 8 Oct 2026): what one page of an application's journey is (the AI's kind, the structure rule
// without AI), and what the extension does there: press a posting's Apply, fill the form, or report it can't reach one ("account",
// "no-form"). Scenarios owned: "Direct application form", "Posting → Apply", "What kind of page", "Sign-up page before the form"
// (docs/flows/applying.md). Guards: extension-tab-pages.test.js, extension-same-tab.test.js, page-kind.test.js and the e2e rows (npm run flows).
// background.js hands over what lives on with the worker (initFillFlow): the tabs a fill started on, the fill itself, its report, onPage.
import {PAGE_FILES, api, clickCombos, settings} from './flow.js';
import {decide} from './log.js';
import {noteRole} from './account.js';
import {expandSections} from './sections.js';
import {accountOutcome, accountStep} from './account-step.js';
import {applyPressed} from './tabs.js';
import {sessionGet} from './tab-memory.js';
import {pageKey, pageRole, pickApplyButton} from './tab-pages.js';

let started = new Set(), fillOpenedTab = async () => null, reportFlow = async () => {}, onPage = async () => true, fillsNow = new Set(), arm = async () => {}, progress = async () => {};
export function initFillFlow(shared) {
  ({started, fillOpenedTab, reportFlow, onPage, fillsNow = new Set(), arm = async () => {}, progress = async () => {}} = shared);
  chrome.runtime.onMessage.addListener(onFillOne);
}

// "Use" on the app's Needs your attention row, passed on by the form's panel (review.js stays read only): that one field is filled
// in the page by the extension's own fill (page/propose.js), the page scripts loaded first if a reload took them. Logged without the value.
function onFillOne(message, sender, reply) {
  if (message?.type !== 'panelFillOne' || !sender.tab) return false;
  const tabId = sender.tab.id, label = String(message.label || '').slice(0, 120), value = String(message.value || '').slice(0, 200);
  const run = () => chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', args: [label, value],
    func: (l, v) => (window.__jobPilottoFillOne ? window.__jobPilottoFillOne(l, v) : {ok: false, missing: true})}).then(([frame]) => frame?.result || {ok: false});
  // Never while this tab's fill is still running: its last pass arms and clicks the menus again and overrode the app's pick (8 Oct 2026, the
  // live twin: "Suisse" picked at 20:13:35, "Allemagne" after the fill's last pass at 20:13:42). Waits for it, at most 90 s.
  const fillDone = async () => { for (let waited = 0; fillsNow.has(tabId) && waited < 90000; waited += 300) await new Promise(resolve => setTimeout(resolve, 300)); };
  fillDone().then(run).then(async result => {
    if (result.missing) {
      await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func: () => { window.__jobPilottoNoGuard = true; }});
      await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', files: PAGE_FILES});
      result = await run();
    }
    // A menu armed with the app's choice (the one that means the same: "Suisse" for "+41") is picked at once when "Fill drop-down menus too" is
    // on, as during the fill; it used to wait for your click every time (owner, 8 Oct 2026: "why are we always stopped at this field?").
    if (!result.ok && result.armed && (await settings()).clickDropdowns !== false) {
      const combos = await clickCombos(tabId).catch(() => []);
      const same = text => String(text || '').replace(/^[\s*]+|[\s*:]+$/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      const mine = combos.find(combo => combo.picked && same(combo.label) === same(label));
      if (mine) result = {...result, ok: mine.matched !== false, armed: false, picked: true, matched: mine.matched};
    }
    decide('fill', result.picked ? (result.matched === false ? 'a menu click selected another choice than asked, asked from the app' : 'a menu picked for you, asked from the app') : result.ok ? 'filled one field asked from the app' : result.armed ? 'a menu armed for your click, asked from the app' : 'could not fill one field asked from the app',
      {field: label.slice(0, 60), translated: !!result.translated, ...(result.picked ? {matched: result.matched !== false} : {})});
    reply({ok: !!result.ok, armed: !!result.armed});
  }).catch(error => reply({ok: false, error: String(error?.message || error)}));
  return true;
}

// Counts only, in the page: no labels and no values. Passwords and file inputs are counted apart from the rest.
function pageShape(tabId) {
  return chrome.scripting.executeScript({target: {tabId}, func: () => {
    const shown = el => el.getClientRects().length > 0 && el.type !== 'hidden';
    const controls = [...document.querySelectorAll('input, textarea, select')].filter(shown);
    const skip = new Set(['submit', 'button', 'reset', 'search', 'image', 'password', 'file', 'hidden']);
    return {
      fields: controls.filter(el => el.tagName !== 'TEXTAREA' && !skip.has(el.type)).length,
      passwords: controls.filter(el => el.type === 'password').length,
      files: controls.filter(el => el.type === 'file').length,
      anyFiles: document.querySelectorAll('input[type=file]').length,   // an upload behind a button ("Upload a CV"): its input is hidden
      textareas: controls.filter(el => el.tagName === 'TEXTAREA').length,
      nodes: document.getElementsByTagName('*').length,   // still growing: a page that renders its form after the load
      frames: [...document.querySelectorAll('iframe')].filter(el => { const box = el.getBoundingClientRect(); return box.width > 40 && box.height > 40; }).length,   // a check drawn in a frame, often seconds after the load
    };
  }}).then(rows => rows?.[0]?.result || null).catch(() => null);
}
// A sketch of the page for the AI that decides its kind (desktop/lib/page-kind.js): headings, every visible control's type and label
// (never its value), and the buttons and short links a person could press. In the page's own language: nothing here matches words.
function pageSketchOf(tabId) {
  return chrome.scripting.executeScript({target: {tabId}, func: () => {
    const shown = el => el.getClientRects().length > 0;
    const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
    const labelOf = el => text(el.labels?.[0]) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || '';
    // Also inside open shadow roots: a page built of web components (SmartRecruiters, 9 Oct 2026) otherwise reads as empty.
    const all = selector => { const found = []; const walk = root => { found.push(...root.querySelectorAll(selector)); for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot); }; walk(document); return found; };
    const controls = all('input, select, textarea')
      .filter(el => el.type === 'file' || (el.type !== 'hidden' && shown(el)))   // an upload behind a button keeps its input hidden
      .filter(el => !['submit', 'button', 'reset', 'image'].includes(el.type))
      .map(el => ({type: el.tagName === 'INPUT' ? el.type : el.tagName.toLowerCase(), label: labelOf(el).slice(0, 80), required: !!el.required || el.getAttribute('aria-required') === 'true'}));
    const buttons = all('button, input[type=submit], [role=button], a').filter(shown)
      .map(el => (el.tagName === 'INPUT' ? el.value : text(el))).filter(words => words && words.length <= 40);
    // The hosts of visible frames (a check drawn in a frame): the AI decides what they are (desktop/lib/page-kind.js bot_check).
    const frames = [...document.querySelectorAll('iframe')].filter(el => { const box = el.getBoundingClientRect(); return box.width > 40 && box.height > 40; })
      .map(el => { try { return new URL(el.src, location.href).hostname; } catch { return ''; } }).filter(Boolean);
    return {title: document.title, headings: all('h1, h2, h3').filter(shown).map(text).filter(Boolean).slice(0, 8),
      controls: controls.slice(0, 50), buttons: [...new Set(buttons)].slice(0, 20), frames: [...new Set(frames)].slice(0, 5)};
  }}).then(rows => rows?.[0]?.result || null).catch(() => null);
}
// The page's kind from the app (the AI's answer, kept per site and page shape), or null: then the structure rule decides alone.
// The kept kind was wrong for this page: the app drops it (desktop/lib/page-kind.js forgetPageKind) and the next visit asks again.
async function forgetKind(tab, kind, reason) {
  const sketch = await pageSketchOf(tab.id);
  decide('fill', `page kind corrected: ${reason}`, {was: kind?.kind || '', by: kind?.by || ''});
  try {
    const config = await settings();
    if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return;
    await api(config, '/extension/page-kind', {method: 'POST', body: JSON.stringify({forget: true, reason, kind: kind?.kind || '', url: tab.url.split('#')[0], ...(sketch || {})})});
  } catch { /* the app is closed: asked again once it is back */ }
}
// What the person sees while the app waits for the AI (the panel's step line; nothing is drawn when the tab has no panel yet). Never throws.
export const sayStep = (tabId, text) => progress(tabId, text).catch(() => {});
export async function askKind(tab) {
  const sketch = await pageSketchOf(tab.id);
  if (!sketch) return null;
  try {
    const config = await settings();
    if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return null;   // your own Worker: no app to ask
    const answer = await Promise.race([api(config, '/extension/page-kind', {method: 'POST', body: JSON.stringify({url: tab.url.split('#')[0], ...sketch})}),
      new Promise(resolve => setTimeout(() => resolve(null), 40000))]);   // a first visit asks the AI cold (the app's AI is the `claude` command: 5-25 s); the structure rule decides only after this, and a wrong rule costs more than the wait
    return answer?.role ? answer : null;
  } catch { return null; }
}
// Claude reads this on <html data-jobpilotto-fill>. States: running, done, error, no-form, account.
function writeState(tabId, value) {
  return chrome.scripting.executeScript({target: {tabId}, args: [JSON.stringify(value)],
    func: text => { if (document.documentElement) document.documentElement.dataset.jobpilottoFill = text; }}).catch(() => {});
}
// The posting before its form: a page with no form and one "Apply" button (chosen by rule: tab-pages.js pickApplyButton).
const PAGE_BUTTONS = 'a[href], button, [role="button"], input[type="button"]';
// A page with no form control of any kind (fill-flow consider waits for it to stop growing before its kind is asked).
export const BOT_CHECK_NEED = 'Solve the robot check in this tab; the form fills after it';   // said in the session (desktop/lib/terminals.js noteStuck)
export const emptyShape = counts => !counts.fields && !counts.passwords && !counts.files && !counts.anyFiles && !counts.textareas;
function applyCandidates(tabId) {
  return chrome.scripting.executeScript({target: {tabId}, func: selector => [...document.querySelectorAll(selector)].map((el, index) => {
    const box = el.getBoundingClientRect(), style = getComputedStyle(el);
    return {index, tag: el.tagName.toLowerCase(), text: (el.innerText || el.value || el.getAttribute('aria-label') || '').slice(0, 80),
      area: Math.round(box.width * box.height), visible: el.getClientRects().length > 0 && style.visibility !== 'hidden',
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', href: el.getAttribute('href') || '',
      // Hard floor, by structure (any language): never a posting's Apply when it submits a form that has fields to fill (an application's
      // Submit), or when the site's own code names it (or its 2 parents) a submit/save button (9 Oct 2026, live: a SuccessFactors form still
      // loading, 0 inputs, read as a posting; its "Postuler" was SPAN#..._submitBtn.rcmSaveButton). A form of hidden inputs only that posts
      // on to the application (an agency's "To apply") is a way in, not a Submit: it is pressed (e2e chain-step).
      submits: (() => {
        const own = node => `${node.id || ''} ${node.getAttribute('name') || ''} ${typeof node.className === 'string' ? node.className : ''}`;
        for (let node = el, depth = 0; node && depth < 3; node = node.parentElement, depth++) if (/submit|save/i.test(own(node))) return true;
        const fields = form => !!form && [...form.elements].some(item => !['hidden', 'submit', 'button', 'reset', 'image'].includes(item.type) && item.getClientRects().length > 0);
        return ['submit', 'image'].includes(el.type) && fields(el.form);
      })()};
  }), args: [PAGE_BUTTONS]}).then(rows => rows?.[0]?.result || []).catch(() => []);
}
// The start-applying phrases the service has learned (extension/alias-schema.js, key apply_button), asked of the app which asks the site and
// remembers: added to the built-in words, never replacing them. None, and the built-in words work alone.
let phrasesAt = 0, phrasesKept = [];
async function applyPhrases() {
  if (Date.now() - phrasesAt < 5 * 60 * 1000) return phrasesKept;
  try {
    const found = await api(await settings(), '/extension/aliases', {method: 'POST', body: '{}'});
    phrasesKept = (Array.isArray(found?.aliases) ? found.aliases : []).filter(item => item && item.key === 'apply_button').slice(0, 500);
    phrasesAt = Date.now();
  } catch { /* the built-in words are enough */ }
  return phrasesKept;
}
// -> {pressed: the button's text or null, via: the service phrase that found it ('' for a built-in word), buttons: the visible button texts
// when none was found (the app counts them, to learn new words; texts only, from a page with no form)}.
async function pressApply(tabId, phrases = []) {
  const candidates = await applyCandidates(tabId);
  const pick = pickApplyButton(candidates, phrases);
  if (!pick) {
    const seen = [...new Set(candidates.filter(item => item.visible && !item.disabled).sort((a, b) => b.area - a.area).map(item => String(item.text || '').replace(/\s+/g, ' ').trim())
      .filter(text => text && text.length <= 40))].slice(0, 25);
    return {pressed: null, via: '', buttons: seen};
  }
  const done = await chrome.scripting.executeScript({target: {tabId}, func: (selector, index) => {
    const el = document.querySelectorAll(selector)[index];
    if (!el) return false;
    el.scrollIntoView({block: 'center'});
    // The next page in this same tab, the way the browser goes there itself (a form keeps what it posts, the page loads once):
    // a link or form that names another tab is pointed at this one (same-tab.js; a tab the page opens by script is followed instead).
    let same = '';
    const link = el.closest('a[target]');
    if (link && link.target.toLowerCase() !== '_self') { link.target = '_self'; same = 'link'; }
    const form = el.form || el.closest('form');
    if (el.getAttribute('formtarget') && el.getAttribute('formtarget').toLowerCase() !== '_self') { el.setAttribute('formtarget', '_self'); same = 'form'; }
    if (form?.target && form.target.toLowerCase() !== '_self') { form.target = '_self'; same = 'form'; }
    const aimed = (link?.getAttribute('target') || el.getAttribute('formtarget') || form?.getAttribute('target') || '').slice(0, 20);
    el.click();
    return {same, tag: el.tagName.toLowerCase(), aimed};
  }, args: [PAGE_BUTTONS, pick.index]}).then(rows => rows?.[0]?.result || null).catch(error => ({error: String(error?.message || error).slice(0, 120)}));
  if (done?.error) { decide('fill', 'the Apply button could not be pressed', {error: done.error}); return {pressed: null, via: '', buttons: []}; }
  return {pressed: done ? pick.text.replace(/\s+/g, ' ').trim().slice(0, 40) : null, via: done ? pick.viaPhrase || '' : '', buttons: [],
    same: done?.same || '', tag: done?.tag || '', aimed: done?.aimed || ''};
}
// After the press: the form shows up on this page (a single-page site), or the tab goes to another page (its own load runs the
// whole decision again). null when neither happens in time.
async function formAfterPress(tabId, url, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const live = await chrome.tabs.get(tabId).catch(() => null);
    if (!live) return 'navigated';   // closed: Apply's new tab is the application now (same-tab.js), not a page with "no form"
    if (pageKey(live.url) !== pageKey(url)) return 'navigated';
    const counts = await pageShape(tabId);
    if (counts && pageRole(counts, live.url) === 'form') return counts;
  }
  return null;
}
// The app is told the extension can't get to this form (its session offers "Apply with Claude"): why, and the site.
// `page`: the page this is about. A tab that has moved on (the account made, the form loaded) sends nothing: a late "account" moved a
// session back from the form to the account step (8 Oct 2026, the matrix's sign-up row). The app checks it too (lib/session-flow.js).
export async function stuck(job, host, why, tabId = null, page = '', needs = '', accountStep = '') {
  if (tabId != null && page && !(await onPage(tabId, page))) { decide('fill', 'the page moved on: no "can\'t reach" report for it', {host, why}); return; }
  const session = tabId == null ? '' : (await sessionGet(`session:${tabId}`))[`session:${tabId}`] || '';
  try { await api(await settings(), '/extension/event', {method: 'POST', body: JSON.stringify({type: 'stuck', url: job, host, why, needs: String(needs || '').slice(0, 80), accountStep: String(accountStep || '').slice(0, 16), tab: tabId, session, page: String(page || '').split('#')[0]})}); } catch { /* the app is closed */ }
}
const triedApply = new Set();
export const fillKey = (tabId, url) => `${tabId} ${pageKey(url)}`;
// A page judged "no form" while it had no field at all may still be drawing its form (a spinner first, or a sign-in that redirects to it:
// SuccessFactors, 9 Oct 2026, where the form came after the judgment and neither the fill nor the panel ever came back). For 20 s it is read
// again; once it has fields the panel is put back (a page that replaced its document lost it) and the page is judged again (a new shape for
// the page-kind AI), then filled. Once per tab and page. Guard: desktop/test/extension-look-again.test.js.
const lookedAgain = new Set();
async function watchForFields(tab, jobUrl, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), looks = 10, seenFrames = null) {
  const key = fillKey(tab.id, tab.url);
  if (lookedAgain.has(key)) return false;
  // The frames the judgment saw (its page shape); a frame drawn since, even before this watch started, makes the page be judged again (twin, 9 Oct 2026:
  // the check's frame came between the judgment and the watch, and counted as already seen).
  const hadFrames = seenFrames === null ? !!(await pageShape(tab.id))?.frames : seenFrames > 0;
  const hostOf = url => { try { return new URL(url).hostname; } catch { return ''; } };
  decide('fill', 'watching a page judged without a form', {host: hostOf(tab.url), looks, frames: hadFrames});   // why a late form or check was (not) seen: twin, 9 Oct 2026
  for (let i = 0; i < looks; i++) {
    await wait(2000);
    const live = await chrome.tabs.get(tab.id).catch(() => null);
    // The same page when only its query string changed (a bot-check service appends its own parameter after the load: SmartRecruiters, 9 Oct 2026).
    const samePage = url => { try { const a = new URL(url), b = new URL(tab.url); return a.origin === b.origin && a.pathname.replace(/\/+$/, '') === b.pathname.replace(/\/+$/, ''); } catch { return false; } };
    if (!live || !samePage(live.url)) { decide('fill', 'watch ended: the tab moved on', {host: hostOf(tab.url), after: (i + 1) * 2, closed: !live, sameHost: !!live && hostOf(live.url) === hostOf(tab.url)}); return false; }   // the next page decides for itself
    const shape = await pageShape(tab.id);
    // Fields came (the form drew late), or a frame did on a page that had none (a bot check injected seconds after the load: SmartRecruiters,
    // 9 Oct 2026): the page is judged again, now with what it shows (page-kind AI: bot_check).
    const framed = !!shape?.frames && !hadFrames;
    if (!shape || (shape.fields + shape.textareas + shape.files < 2 && !framed)) continue;
    lookedAgain.add(key);
    started.delete(key);
    let host = ''; try { host = new URL(live.url).hostname; } catch { /* no address */ }
    decide('fill', framed ? 'a frame appeared on a page judged without a form: looking again' : 'fields appeared on a page judged without a form: looking again', {host, fields: shape.fields + shape.textareas + shape.files, frames: shape.frames || 0, after: (i + 1) * 2});
    await arm(tab.id, 'fields appeared');
    await consider(live, jobUrl);
    return true;
  }
  decide('fill', 'watch ended: no form and no new frame', {host: hostOf(tab.url), after: looks * 2});
  return false;
}
// One page of an armed tab. A form is filled. A password page and a page with no form are left for Claude,
// and the page says which, so Claude does not wait for a fill that will not come.
export async function consider(tab, jobUrl) {
  const key = fillKey(tab.id, tab.url);
  if (started.has(key)) return;
  started.add(key);
  await new Promise(resolve => setTimeout(resolve, 1500)); // the form renders after the load event
  const live = await chrome.tabs.get(tab.id).catch(() => null);
  if (!live || pageKey(live.url) !== pageKey(tab.url)) { started.delete(key); return; }
  await expandSections(live);   // a form drawn with collapsed sections (SuccessFactors) is read open, or it looks empty and is judged "no form" (sections.js)
  // The page can refuse a read right after its load (still swapping documents, the worker just woke): look again before giving up,
  // or the tab is left with no fill and no state at all, for Claude and the app to wait on.
  let counts = await pageShape(tab.id);
  for (let again = 0; !counts && again < 4; again++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    counts = await pageShape(tab.id);
  }
  // No control at all while the page is still growing (a form rendered by script after its load, "Chargement en cours…"): read it again
  // before anyone judges it, or a loading form is called a posting and its Submit pressed as Apply (9 Oct 2026, SuccessFactors). A static page: one extra second.
  for (let wait = 0; counts && emptyShape(counts) && wait < 4; wait++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const next = await pageShape(tab.id);
    if (!next) break;
    const growing = next.nodes !== counts.nodes;
    counts = next;
    if (!growing) break;
  }
  if (!counts) {
    started.delete(key);
    decide('fill', 'the page could not be read', {host: (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })()});
    return;
  }
  // A sign-up form was open in this tab (we filled it) and the page changed: what became of it is the account AI's word (account-step.js accountOutcome).
  // The two AI looks do not depend on each other (the outcome of a sign-up, the kind of this page): asked together, the wait is the longer one, not the sum (9 Oct 2026, Migros: 13 s then 9 s, one after the other).
  const lookedAt = Date.now();
  sayStep(tab.id, 'Reading this page…');
  const kindAsk = askKind(tab), outcomeLook = accountOutcome(tab).catch(() => {});
  const asked = await kindAsk;
  // The application form: fill it now; what became of the sign-up before it is the account AI's word a moment later, for the card only (owner, 9 Oct 2026: the fill
  // waited 40 s on it on Migros while the page was already the form). Any other page (an account page, a posting, nothing known) waits for it, as the sign-in →
  // sign-up switch and the account step go by it. Guard: worker/test/account-step.test.js.
  if (asked?.role !== 'form') await outcomeLook;
  const outcomeMs = Date.now() - lookedAt;   // what the fill waited before it could go on
  // What kind of page this is: the AI's word for this site and page shape (asked once, kept), in any language; the structure rule when
  // there is none (no AI, unsure). Every flow below goes by the role either one gives (docs/flows/applying.md).
  const ruled = pageRole(counts, tab.url), kind = asked;
  let role = kind?.role || ruled, noted = '';   // noted: what the page is called to the app and the learning, when the fill below treats it as something else
  // Self-correction: a "form" with nothing to fill is not one. The kept answer goes; the structure rule decides this visit.
  const controls = (Number(counts.fields) || 0) + (Number(counts.files) || 0) + (Number(counts.textareas) || 0) + (Number(counts.passwords) || 0);
  if (kind && role === 'form' && controls === 0) { await forgetKind(tab, kind, 'a form with no fields'); role = ruled; }
  // A sign-in or sign-up page whose step matches what the app says about this email on this site (sign_up while we have no account here, sign_in once we do):
  // the person's details go in by the normal fill (the label meanings, any language); the passwords and the account button are account-step.js.
  if (role === 'account' && kind?.accountStep) {
    const host0 = (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })();
    const peek = await api(await settings(), '/extension/site-password', {method: 'POST', body: JSON.stringify({host: host0, peek: true, session: (await sessionGet(`session:${tab.id}`))[`session:${tab.id}`] || ''})}).catch(() => null);
    if (peek?.ok && peek.email && ((kind.accountStep === 'sign_up' && peek.mode === 'sign-up') || (kind.accountStep === 'sign_in' && peek.mode === 'sign-in'))) { role = 'form'; noted = 'account'; decide('fill', `${kind.accountStep} page: filled with your details`, {host: host0}); }
  }
  decide('fill', `page kind: ${kind?.kind || ruled}`, {by: kind ? kind.by : 'structure rule', confidence: kind?.confidence ?? null, ms: Date.now() - lookedAt, outcomeMs,
    ...(kind && kind.role !== ruled ? {rule: ruled} : {}), host: (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })()});
  await noteRole(tab.id, tab.url, noted || role);   // a sign-up page filled like a form is still an account page: no application learning, no "application form" stage (Migros, 8 Oct 2026)
  // Event-driven: an account page is looked at the moment its kind is known, not at the panel's next tick. One filled with your details is looked at AFTER
  // that fill: its "ready?" judgment must see the email in (jobs.ch, 9 Oct 2026: judged 0.3 s before the fill typed it, "Email address" missing, nothing pressed).
  const accountPage = kind?.role === 'account' || ruled === 'account', accountAfterFill = accountPage && noted === 'account';
  if (accountPage && !accountAfterFill) accountStep(tab, 0).catch(() => {});
  let host = '';
  try { host = new URL(tab.url).hostname; } catch { /* not a url */ }
  // Tier 2: the posting before its form. Press its "Apply" button once (by rule), then wait for the form.
  let pressed = false, buttonsSeen = [];
  if (role === 'no-form' && !triedApply.has(key)) {
    triedApply.add(key);
    // The shared phrases, and the button the page-kind AI named on this page (any language; already checked against the page and the schema).
    const phrases = [...await applyPhrases(), ...(kind?.applyButton ? [{key: 'apply_button', phrase: kind.applyButton}] : [])];
    applyPressed.set(tab.id, {at: Date.now(), url: tab.url});   // before the click: the site opens its new tab during it (same-tab.js)
    const attempt = await pressApply(tab.id, phrases);
    if (!attempt.pressed) applyPressed.delete(tab.id);
    const label = attempt.pressed;
    buttonsSeen = attempt.buttons;
    if (label) {
      pressed = true;
      decide('fill', 'pressed the Apply button', {host, label, tag: attempt.tag, aimed: attempt.aimed, sameTab: attempt.same});   // sameTab: a link/form aimed at a new tab, pointed at this one
      const after = await formAfterPress(tab.id, tab.url);
      if (attempt.via) reportFlow(tab, null, {aliasUse: [{phrase: attempt.via, ok: after !== null}]});   // did a phrase from the service open the form?
      if (after === 'navigated') { started.delete(key); return; }   // the next page decides for itself (onUpdated)
      if (after) { role = 'form'; await noteRole(tab.id, tab.url, role); }
    }
  }
  // Self-correction: called a posting, but there was no Apply to press and the page has an application form's fields: it is the form.
  if (kind?.role === 'no-form' && !pressed && ruled === 'form') { await forgetKind(tab, kind, 'a posting with no Apply but a form\'s fields'); role = 'form'; await noteRole(tab.id, tab.url, role); }
  if (role !== 'form') {
    await progress(tab.id, '');   // no fill here: the panel's "Starting…" ends now, not after its 20 s (owner, 9 Oct 2026: it spun on a sign-in page left to them)
    // A check that the visitor is human in front of the page (the page-kind AI's bot_check): the person solves it in this tab; the form is watched for two
    // minutes and filled once it shows (SmartRecruiters, 9 Oct 2026: the check was read as an empty page, "no form", and nobody was told).
    const botCheck = role === 'no-form' && kind?.botCheck === true;
    if (botCheck || (role === 'no-form' && counts && emptyShape(counts))) watchForFields(tab, jobUrl, undefined, botCheck ? 60 : 10, counts?.frames ?? 0).catch(() => {});   // judged while still empty: look again if fields come
    await writeState(tab.id, {state: role});
    decide('fill', role === 'account' ? 'account page left for Claude' : botCheck ? 'a bot check in front of the page: handed to the person' : 'no form on this page', {host, role});
    if (!(role === 'account' && kind?.accountStep)) stuck(String(jobUrl || tab.url).split('#')[0], host, role === 'account' ? 'account' : 'no-form', tab.id, tab.url, botCheck ? BOT_CHECK_NEED : '');   // tier 3: the app offers Apply with Claude; an account page the AI has a step for is the account step's (it reports when it cannot finish)
    reportFlow(tab, {role, pressed}, {buttons: pressed ? [] : buttonsSeen});
    return;
  }
  decide('fill', 'filling', {host, job: new URL(String(jobUrl || tab.url)).pathname, page: new URL(tab.url).pathname});   // which posting's kit this page uses
  await writeState(tab.id, {state: 'running'});
  const result = await fillOpenedTab(live, String(jobUrl || tab.url).split('#')[0], false, {fast: true, quiet: true});
  await writeState(tab.id, result?.error ? {state: 'error', error: String(result.error).slice(0, 160)}
    : {state: 'done', filled: result?.filled || 0, left: (result?.todo || []).length, todo: (result?.todo || []).slice(0, 20)});
  reportFlow(tab, {role: 'form', ok: !result?.error});
  if (accountAfterFill) accountStep(tab, 0).catch(() => {});   // the account page, now with your details in (above)
}
