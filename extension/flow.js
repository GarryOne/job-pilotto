// One fill run on a tab: read the form, get answers (AI and/or the drafted kit), fill, report.
// Shared by the popup (the tab you're on) and the background worker (tabs the app opens to fill).
import {kitStance} from './tab-pages.js';
import {fillCard} from './fill-card.js';
export const JOB_SITES = [
  'https://*.greenhouse.io/*', 'https://jobs.lever.co/*', 'https://jobs.ashbyhq.com/*',
  'https://*.myworkdayjobs.com/*', 'https://*.smartrecruiters.com/*', 'https://apply.workable.com/*',
  // Employer application sites common in Switzerland and Europe (a job board's Apply often leads there).
  'https://*.successfactors.eu/*', 'https://*.successfactors.com/*', 'https://*.jobs.personio.de/*', 'https://*.jobs.personio.com/*', 'https://*.teamtailor.com/*',
  'https://*.recruitee.com/*', 'https://*.softgarden.io/*', 'https://*.umantis.com/*', 'https://*.taleo.net/*', 'https://*.icims.com/*', 'https://*.bamboohr.com/*',
];

// "Fill drop-down menus too": searchable dropdowns (Greenhouse react-select) open only for real input, so
// the extension clicks each armed one through Chrome's debugger (trusted input; Chrome shows a debugging
// bar meanwhile); the page script then picks the kit's answer in the opened menu. Returns how many got picked.
export async function clickCombos(tabId) {
  const page = (func, args = []) => chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func, args})
    .then(([r]) => r?.result);
  const results = [];
  if (!(await page(() => window.__jobPilottoArmedCount?.() || 0))) return results;
  const target = {tabId};
  await chrome.debugger.attach(target, '1.3');
  const mouse = (type, x, y) => chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent',
    {type, x, y, button: 'left', clickCount: 1});
  const click = async (x, y) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); };
  let skip = 0;
  try {
    for (let i = 0; i < 40; i++) {
      const spot = await page(n => window.__jobPilottoNextCombo(n), [skip]);
      if (!spot) break;
      const started = Date.now();
      let picked = false;
      for (let attempt = 1; attempt <= 2 && !picked; attempt++) {
        const before = await page(() => window.__jobPilottoArmedCount());
        const at = attempt === 1 ? spot : await page(n => window.__jobPilottoNextCombo(n), [skip]);
        if (!at) break;
        await click(at.x, at.y);
        // The page opens the menu, filters it and picks the answer: a fixed list picks within a few tenths of a second,
        // so it gets 1.5 s; a search field that is still loading its suggestions from the server gets up to 5 s.
        const loading = () => page(() => !!document.querySelector('[class*=loading-indicator], [class*=loadingIndicator], [class*=menu-notice--loading], [class*=loadingMessage]'));
        for (let waited = 0, limit = 1500; waited < limit; waited += 100) {
          await new Promise(r => setTimeout(r, 100));
          if ((await page(() => window.__jobPilottoArmedCount())) < before) break;
          if (limit < 5000 && await loading()) limit = 5000;
        }
        picked = (await page(() => window.__jobPilottoArmedCount())) < before;
        if (!picked) { await click(5, 5).catch(() => {}); await new Promise(r => setTimeout(r, 100)); }  // close the menu
      }
      results.push({label: spot.label, picked, ms: Date.now() - started});
      if (!picked) skip += 1;
    }
    // A phone widget whose country was just picked: type the number for real, so the form registers it.
    const phone = await page(() => window.__jobPilottoPhoneSpot?.());
    if (phone) {
      await click(phone.x, phone.y);
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {type: 'rawKeyDown', key: 'a', code: 'KeyA',
        windowsVirtualKeyCode: 65, modifiers: 4, commands: ['selectAll']});
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4});
      await chrome.debugger.sendCommand(target, 'Input.insertText', {text: phone.text});
      results.push({label: 'Phone (typed for real)', picked: true, ms: 0});
    }
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
  return results;
}

// The approved cover letter PDF travels inside the resume argument: the page helper attaches it to a file input labelled Cover letter.
const withLetterFile = (resume, file) => (file ? {...(resume || {}), coverLetterFile: file} : resume);

export async function settings() {
  return chrome.storage.local.get(['workerUrl', 'token', 'profile', 'resume', 'checkEligibility', 'testMode', 'clickDropdowns', 'acceptConsents']);
}

// The Job Pilotto Mac app gives its connection to this extension only (it checks the extension's ID).
export const APP = 'http://127.0.0.1:47111';
export const NOT_CONNECTED = "the Job Pilotto app didn't accept this extension, even after reconnecting";
export const NO_APP = "can't reach the Job Pilotto app: is it open?";
const usesApp = config => !config.workerUrl || config.workerUrl.startsWith(APP);

// Connect to the app (the Settings button, and by itself whenever the app turns the token down).
export async function pair() {
  const response = await fetch(`${APP}/extension/pair`);
  if (!response.ok) throw new Error(`the app answered ${response.status}`);
  const {url, token} = await response.json();
  await chrome.storage.local.set({workerUrl: url, token});
  return {workerUrl: url, token};
}

// A call to the app (or your own Worker). The app's token changes when it's reinstalled, reset or switched to
// another Notion workspace: a 401 from the app reconnects once and retries, so the user never has to.
export async function api(config, path, init = {}, retry = true) {
  if (usesApp(config) && !config.token) Object.assign(config, await pair());
  const response = await fetch(`${config.workerUrl.replace(/\/$/, '')}${path}`, {
    ...init, headers: {Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', ...(init.headers || {})},
  });
  if (response.status === 401 && retry && usesApp(config)) {
    const fresh = await pair().catch(() => null);
    if (fresh && fresh.token !== config.token) return api(Object.assign(config, fresh), path, init, false);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(response.status === 401 ? NOT_CONNECTED : data.error || `HTTP ${response.status}`), {status: response.status, data});
  return data;
}

// Why a field was left that is the extension's fault, not missing data (desktop/lib/reports.js reports these).
const MECHANICAL = ['dropdown clicked, but no option matched', 'dropdown that opens only on a real click',
  'answer given, but the field did not take it', 'question text not found on the page',
  'question on the page not read'];

const inPage = (tabId, func, args = []) => chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func, args})
  .then(([result]) => result?.result);

// useAI: ask the Worker to answer every open field. force: fill even when the AI says you're not eligible.
// onStep(text): what's happening now, for the popup and the on-page panel.
// Claude's reply for a tab (answers + eligibility), kept for the tab's session so the popup shows the result of
// an automatic fill and "Fill anyway" reuses the answers instead of asking (and paying) again.
const cacheKey = tab => `fill:${tab.id}`;
export async function cachedAI(tab) {
  const entry = (await chrome.storage.session.get(cacheKey(tab)))[cacheKey(tab)];
  const {testMode = false} = await chrome.storage.local.get('testMode');
  return entry && entry.url === tab.url.split('#')[0] && !!entry.test === testMode ? entry.ai : null;
}
export function forgetAI(tab) { return chrome.storage.session.remove(cacheKey(tab)); }

// jobUrl: the posting the kit belongs to, when the form lives elsewhere (a job board's Apply led to the employer's site).
// me: your contact details and CV when already fetched (the panel prefetches them), so the fill starts at once.
export async function fillTab(tab, config, {useAI = true, force = false, kitAnswers = [], hasKit = false, onStep = () => {}, reuse = true, coverLetter = '', jobUrl = '', me: early = null} = {}) {
  const startedAt = new Date();
  const job = (jobUrl || tab.url).split('#')[0];
  chrome.storage.session.set({[`job:${tab.id}`]: job, [`from:${tab.id}`]: job});
  const event = (type, extra = {}) => api(config, '/extension/event', {method: 'POST',
    body: JSON.stringify({type, url: job, ...extra})}).catch(() => {});
  event('fill-started');
  // A kit exists for this job (drafted when it was prepared, its eligibility already judged) even when none of its answers
  // matches this form's fields: the form's own questions are only visible now, so Claude answers those after the fill, but the
  // eligibility stop is not asked again (2 Oct 2026: a ready kit still waited 10-30 s and re-checked eligibility).
  const {withKit} = kitStance({kitAnswers, hasKit});
  // Everything about this fill, for debugging and improving the extension (saved with the run in Notion).
  const debug = {version: chrome.runtime.getManifest().version, browser: navigator.userAgent, steps: [], errors: []};
  let stepAt = Date.now();
  const step = name => { const now = Date.now(); debug.steps.push({step: name, ms: now - stepAt}); stepAt = now; };
  onStep('Reading the form…');
  // No Submit guard for the extension: it never submits, and the user presses Submit themselves.
  await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', func: () => { window.__jobPilottoNoGuard = true; }});
  await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN',
    files: ['page/browser-submit-guard.js', 'page/browser-form-fastpath.js', 'page/snapshot.js', 'page/skeleton.js', 'page/controls.js', 'page/coverage.js', 'page/fill.js']});
  // Recipes for the kinds of control on this form, asked of the app by fingerprint (it asks the site, and remembers). A recipe
  // only configures a generic operator; no recipe, or no answer, and the operators work with their own defaults.
  try {
    const prints = await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', func: () => window.__jobPilottoControls?.fingerprints?.() || []})
      .then(rows => rows?.[0]?.result || []);
    if (prints.length) {
      const found = await api(config, '/extension/recipes', {method: 'POST', body: JSON.stringify({fingerprints: prints})});
      await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', args: [found?.recipes || {}], func: recipes => { window.__jobPilottoRecipes = recipes; }});
    }
  } catch { /* recipes are a bonus: the operators work without them */ }
  // Label meanings from the service (extension/alias-schema.js), asked of the app which asks the site and remembers: the filler uses them
  // only for a question no built-in pattern placed. No answer, and the built-in patterns work as before.
  try {
    const packs = await api(config, '/extension/aliases', {method: 'POST', body: '{}'});
    await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', args: [Array.isArray(packs?.aliases) ? packs.aliases.slice(0, 2000) : []], func: aliases => { window.__jobPilottoAliases = aliases; }});
  } catch { /* aliases are a bonus */ }
  let answers = kitAnswers.map(a => ({field: a.field, value: a.answer, question: a.question, source: 'kit',
    confidence: a.needs_review ? 'low' : 'high'}));
  let ai = null, aiError = null, later = [];
  // Contact details and CV come from the Job Pilotto app each time (it's the one place they live).
  const me = early || await api(config, `/extension/me?url=${encodeURIComponent(job)}`).catch(error => {
    // No app or no connection: stop, rather than fill a form without your name and CV.
    if (usesApp(config) && (!error.status || error.status === 401)) throw new Error(error.status ? NOT_CONNECTED : NO_APP);
    debug.errors.push(`details from the app: ${error.message}`);
    return null;
  });
  // The best of both, like an Apply with Claude session: the kit's answers first (drafted when the kit was made),
  // then Claude only for the questions they don't cover, so nothing is left empty that could be answered. A form
  // the kit covers fully costs nothing (no call when nothing is open).
  if (useAI) {
    const form = await inPage(tab.id, async () => [...await window.__jobPilottoDescribeForm(),
      ...window.__jobPilottoCheckboxQuestions().map(g => ({field: `group:${g.question}`, label: g.question, type: 'checkbox-group', options: g.options}))]);
    step('read the form');
    debug.form = (form || []).map(({field, label, type, required, filled, legal, options}) =>
      ({field, label, type, required, filled, legal, options: (options || []).slice(0, 30)}));
    // What goes to Claude is only what nothing else answers: not a field the kit covers (answered, or left empty on
    // purpose: an optional question it chose to skip), not your contact details and CV (the app's, filled below),
    // not a file. A form the kit was drafted from therefore needs no Claude call at all.
    const fromKit = new Set(kitAnswers.map(a => a.field).filter(Boolean));
    const contact = new Set((await inPage(tab.id, (rows, profile) => window.__jobPilottoProfileEntries(rows, profile).map(e => e.field),
      [form || [], me?.contact || config.profile || {}]).catch(() => [])) || []);
    const PERSONAL = /^(first_name|last_name|preferred_name|email|phone|resume|resume_text|cover_letter|cover_letter_text|longitude|latitude)$/;
    const open = (form || []).filter(f => !f.filled && !f.legal && f.type !== 'file' && !fromKit.has(f.field) && !contact.has(f.field) &&
      !PERSONAL.test(f.field)).map(({field, label, type, required, options}) => ({field, label, type, required, options}));
    debug.sentToClaude = open.map(f => f.field);
    // With a kit, applying was the user's decision (they prepared it): no eligibility stop, and no waiting: everything
    // known fills at once, and Claude answers what's left afterwards (below), while you already see the form filled.
    if (kitStance({kitAnswers, hasKit, matched: fromKit.size}).skipEligibility) force = true;
    if (withKit) later = open;
    const cached = reuse && !withKit ? await cachedAI(tab) : null;
    if (withKit) { /* Claude after the fill */ } else if (cached) {
      ai = cached;
      if (!ai.eligible && !force && config.checkEligibility !== false) return {ineligible: true, note: ai.eligibility_note, usd: 0};
      const byAI = new Set(ai.answers.map(a => a.field));
      answers = [...ai.answers.map(a => ({...a, source: 'Claude (on the page)'})), ...answers.filter(a => !byAI.has(a.field))];
    } else if (open.length) {
      onStep(withKit ? `Claude is answering ${open.length} question${open.length === 1 ? '' : 's'} the kit doesn't cover (10–30 s)…`
        : `Claude is answering ${open.length} question${open.length === 1 ? '' : 's'} and checking you're eligible (usually 10–30 s)…`);
      try {
        const pageText = await inPage(tab.id, () => window.__jobPilottoPageText());
        ai = await api(config, '/extension/answer', {method: 'POST',
          body: JSON.stringify({url: tab.url, fields: open, page_text: pageText, test: !!config.testMode})});
        await chrome.storage.session.set({[cacheKey(tab)]: {url: tab.url.split('#')[0], ai, test: !!config.testMode}});
        // Settings → "Check eligibility before filling" off (for testing): fill regardless.
        if (!ai.eligible && !force && config.checkEligibility !== false) return {ineligible: true, note: ai.eligibility_note, usd: ai.usd};
        // The AI saw the live form, so its answer wins; kit answers fill whatever it left out.
        const byAI = new Set(ai.answers.map(a => a.field));
        answers = [...ai.answers.map(a => ({...a, source: 'Claude (on the page)'})), ...answers.filter(a => !byAI.has(a.field))];
      } catch (error) {
        aiError = error.message;
        debug.errors.push(`Claude: ${error.message}`);
      }
      step('Claude answered');
    }
  }
  onStep('Filling the form…');
  if (!debug.form) {  // filled from the kit: still record the form as read, for the run log
    const seen = await inPage(tab.id, () => window.__jobPilottoDescribeForm()).catch(() => []);
    debug.form = (seen || []).map(({field, label, type, required, filled, legal, options}) =>
      ({field, label, type, required, filled, legal, options: (options || []).slice(0, 30)}));
  }
  // Learned notes (🧠 Form knowledge) answer fields nothing else did, matched by label and site.
  const host = new URL(tab.url).hostname, company = (tab.url.match(/\/([\w-]+)\/jobs\//) || [])[1] || '';
  const answered = new Set(answers.map(a => a.field));
  const labelKey = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (const field of debug.form || []) {
    if (answered.has(field.field) || field.filled || field.legal) continue;
    const note = (me?.knowledge || []).find(n => labelKey(n.field) === labelKey(field.label) &&
      (n.scope === 'any' || host.includes(n.scope) || n.scope.toLowerCase() === company));
    if (note) { answers.push({field: field.field, value: note.value, source: 'form knowledge', question: field.label}); answered.add(field.field); }
  }
  debug.answers = answers.map(({field, question, value, source, confidence, note}) => ({field, question, value, source, confidence, note}));
  debug.details = {coverLetterFile: !!me?.coverLetterFile, fields: Object.keys(me?.contact || {}), source: me?.contactSource || null, cv: me?.resume?.name || null, tailoredCv: !!me?.resume?.tailored};
  if (me?.contactError) debug.errors.push(`your details: ${me.contactError}`);
  const letter = coverLetter || ai?.cover_letter || '';
  const summary = await inPage(tab.id, (list, profile, resume, letter, consents) => window.__jobPilottoExtensionFill(list, profile, resume, letter, consents),
    [answers, me?.contact || config.profile || {}, withLetterFile(me?.resume || config.resume || null, me?.coverLetterFile), letter, config.acceptConsents === true]);
  const armedLeft = () => inPage(tab.id, () => window.__jobPilottoArmedCount?.() || 0);
  step('filled the page');
  // Your details couldn't be read (Notion failed and there was no earlier copy): say so on the fields it left,
  // not "no answer", and in the panel, so Fill again is the obvious next step.
  if (me?.contactError && !Object.keys(me.contact || {}).length && summary) {
    const why = `your details couldn't be read (${me.contactError}): Fill again in a minute`;
    for (const row of summary.trace || []) if (row.reason === 'no answer in the kit, Profile or your details' && /name|e-?mail|phone|country|city|location/i.test(row.label)) row.reason = why;
    summary.todo = [`Your name and email weren't filled: ${why}`, ...(summary.todo || [])];
  }
  const clickDropdowns = config.clickDropdowns !== false;  // on unless turned off in Settings
  if (!clickDropdowns && await armedLeft()) {
    // Say why they're left, and how to have them chosen automatically.
    summary.todo = [...(summary.todo || []), 'Tip: turn on "Fill drop-down menus too" in the extension Settings to have these chosen for you'];
  }
  if (clickDropdowns) {
    onStep('Choosing the drop-down answers…');
    try {
      const combos = await clickCombos(tab.id);
      debug.dropdowns = combos;
      step('clicked dropdowns');
      const picked = combos.filter(c => c.picked).length;
      for (const combo of combos) {
        const row = (summary.trace || []).find(r => r.label === combo.label);
        if (row) Object.assign(row, {outcome: combo.picked ? 'filled' : 'left', source: row.source || 'kit',
          reason: combo.picked ? `dropdown clicked for you (${(combo.ms / 1000).toFixed(1)} s)` : `dropdown clicked, but no option matched (${(combo.ms / 1000).toFixed(1)} s)`});
      }
      if (picked) {
        summary.filled = (summary.filled || 0) + picked;
        summary.todo = (summary.todo || []).filter(item => !/highlighted dropdown/.test(item));
        const left = await inPage(tab.id, () => window.__jobPilottoArmedCount());
        if (left) summary.todo.unshift(`Click the ${left} highlighted dropdown(s); each picks its answer when opened`);
      }
    } catch (error) {
      debug.errors.push(`dropdowns: ${error.message}`);
      summary.todo = [`Drop-downs not chosen automatically (${error.message}): click each highlighted one`, ...(summary.todo || [])];
    }
  }
  // With a kit: the questions it doesn't cover, answered by Claude now that the rest is already on the page.
  if (later.length && useAI) {
    onStep(`Claude is answering ${later.length} more question${later.length === 1 ? '' : 's'}…`);
    try {
      const pageText = await inPage(tab.id, () => window.__jobPilottoPageText());
      ai = await api(config, '/extension/answer', {method: 'POST',
        body: JSON.stringify({url: tab.url, fields: later, page_text: pageText, test: !!config.testMode})});
      step('Claude answered (after the fill)');
      const extra = ai.answers.filter(a => later.some(f => f.field === a.field)).map(a => ({...a, source: 'Claude (on the page)'}));
      if (extra.length) {
        // Only Claude's answers this time: no contact details or CV again (they're in already).
        const more = await inPage(tab.id, (list, consents) => window.__jobPilottoExtensionFill(list, {}, null, '', consents), [extra, config.acceptConsents === true]);
        const combos = config.clickDropdowns !== false ? await clickCombos(tab.id).catch(() => []) : [];
        debug.laterDropdowns = combos;
        summary.filled = (summary.filled || 0) + (more?.filled || 0) + combos.filter(c => c.picked).length;
        summary.unfilledRequired = more?.unfilledRequired ?? summary.unfilledRequired;
        summary.trace = [...(summary.trace || []), ...(more?.trace || []).filter(row => row.source === 'Claude (on the page)')];
        step('filled Claude\'s answers');
      }
    } catch (error) {
      aiError = error.message;
      debug.errors.push(`Claude (after the fill): ${error.message}`);
    }
  }
  // Fields left for a mechanical reason (a widget the extension couldn't operate): a scrubbed HTML snapshot of each,
  // for the fill-failure report's replay test (page/snapshot.js). Your details are passed only to hide them.
  const snapshots = await inPage(tab.id, (targets, secrets) => window.__jobPilottoSnapshots?.(targets, secrets) || {},
    [(summary.trace || []).filter(row => MECHANICAL.some(reason => String(row.reason || '').startsWith(reason))).map(row =>
      ({label: row.label, field: (debug.form || []).find(f => f.label === row.label)?.field || ''})),
    Object.values(me?.contact || config.profile || {}).filter(value => typeof value === 'string')]).catch(() => ({}));
  // One anonymous record of this fill for the learning digest (fill-card.js: counts and fixed words), and its id on the page so
  // the panel can add, at Submit, what you answered yourself.
  summary.card = fillCard({id: crypto.randomUUID(), trace: summary.trace || [], form: debug.form || [],
    sent: [...(debug.sentToClaude || []), ...later.map(f => f.field)], ai, aiError, useAI, kit: withKit, version: debug.version, startedAt});
  await inPage(tab.id, id => { document.documentElement.dataset.jobpilottoFill = id; }, [summary.card.id]).catch(() => {});
  event('fill-done', {filled: summary.filled || 0, left: (summary.todo || []).length});
  // One row in 🎏 Job Apply — Agent Runs (Agent = Extension), comparable with the agent runs there.
  api(config, '/extension/run', {method: 'POST', body: JSON.stringify({url: job, started: startedAt.toISOString(),
    ended: new Date().toISOString(), fields: summary.filled || 0, unfilled: summary.unfilledRequired || 0, usd: ai?.usd || 0,
    kit: withKit, todo: (summary.todo || []).slice(0, 8), trace: summary.trace || [], snapshots: snapshots || {}, debug: {...debug, aiUsd: ai?.usd || 0}})})
    .then(logged => logged?.url && chrome.storage.session.set({[`run:${tab.id}`]: logged.url})).catch(() => {});
  return {...summary, usd: ai?.usd, aiError, coverLetter: ai?.cover_letter};
}
