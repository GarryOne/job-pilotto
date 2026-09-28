// One fill run on a tab: read the form, get answers (AI and/or the drafted kit), fill, report.
// Shared by the popup (the tab you're on) and the background worker ("Open & fill" from the queue).
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
        // The page opens the menu, filters it and picks the answer (search fields wait for server suggestions).
        for (let waited = 0; waited < 5000; waited += 300) {
          await new Promise(r => setTimeout(r, 300));
          if ((await page(() => window.__jobPilottoArmedCount())) < before) break;
        }
        picked = (await page(() => window.__jobPilottoArmedCount())) < before;
        if (!picked) { await click(5, 5).catch(() => {}); await new Promise(r => setTimeout(r, 200)); }  // close the menu
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

export async function settings() {
  return chrome.storage.local.get(['workerUrl', 'token', 'profile', 'resume', 'checkEligibility', 'testMode', 'clickDropdowns', 'acceptConsents']);
}

export async function api(config, path, init = {}) {
  const response = await fetch(`${config.workerUrl.replace(/\/$/, '')}${path}`, {
    ...init, headers: {Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', ...(init.headers || {})},
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), {status: response.status, data});
  return data;
}

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
export async function fillTab(tab, config, {useAI = true, force = false, kitAnswers = [], onStep = () => {}, reuse = true, coverLetter = '', jobUrl = ''} = {}) {
  const startedAt = new Date();
  const job = (jobUrl || tab.url).split('#')[0];
  chrome.storage.session.set({[`job:${tab.id}`]: job, [`from:${tab.id}`]: job});
  const event = (type, extra = {}) => api(config, '/extension/event', {method: 'POST',
    body: JSON.stringify({type, url: job, ...extra})}).catch(() => {});
  event('fill-started');
  const withKit = kitAnswers.length > 0;
  // Everything about this fill, for debugging and improving the extension (saved with the run in Notion).
  const debug = {version: chrome.runtime.getManifest().version, browser: navigator.userAgent, steps: [], errors: []};
  let stepAt = Date.now();
  const step = name => { const now = Date.now(); debug.steps.push({step: name, ms: now - stepAt}); stepAt = now; };
  onStep('Reading the form…');
  // No Submit guard for the extension: it never submits, and the user presses Submit themselves.
  await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', func: () => { window.__jobPilottoNoGuard = true; }});
  await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN',
    files: ['page/browser-submit-guard.js', 'page/browser-form-fastpath.js', 'page/fill.js']});
  let answers = kitAnswers.map(a => ({field: a.field, value: a.answer, question: a.question, source: 'kit',
    confidence: a.needs_review ? 'low' : 'high'}));
  let ai = null, aiError = null;
  // A job with a kit fills from it at once: the form was read and answered (and eligibility decided) when
  // the kit was drafted, so no Claude call here; anything the kit missed is listed for the user.
  if (kitAnswers.length) useAI = false;
  if (useAI) {
    const form = await inPage(tab.id, async () => [...await window.__jobPilottoDescribeForm(),
      ...window.__jobPilottoCheckboxQuestions().map(g => ({field: `group:${g.question}`, label: g.question, type: 'checkbox-group', options: g.options}))]);
    step('read the form');
    debug.form = (form || []).map(({field, label, type, required, filled, legal, options}) =>
      ({field, label, type, required, filled, legal, options: (options || []).slice(0, 30)}));
    // Fields the kit already answered (drafted ahead from the form's questions) don't go to Claude.
    const fromKit = new Set(answers.filter(a => a.value).map(a => a.field));
    const open = (form || []).filter(f => !f.filled && !f.legal && !fromKit.has(f.field)).map(({field, label, type, required, options}) =>
      ({field, label, type, required, options}));
    // With a kit, applying was the user's decision (they prepared it): no eligibility stop.
    if (fromKit.size) force = true;
    const cached = reuse ? await cachedAI(tab) : null;
    if (cached) {
      ai = cached;
      if (!ai.eligible && !force && config.checkEligibility !== false) return {ineligible: true, note: ai.eligibility_note, usd: 0};
      const byAI = new Set(ai.answers.map(a => a.field));
      answers = [...ai.answers.map(a => ({...a, source: 'Claude (on the page)'})), ...answers.filter(a => !byAI.has(a.field))];
    } else if (open.length) {
      onStep(`Claude is answering ${open.length} question${open.length === 1 ? '' : 's'} and checking you're eligible (usually 10–30 s)…`);
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
  // Contact details and CV come from the Job Pilotto app each time (it's the one place they live).
  const me = await api(config, `/extension/me?url=${encodeURIComponent(job)}`).catch(error => { debug.errors.push(`details from the app: ${error.message}`); return null; });
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
  debug.details = {fields: Object.keys(me?.contact || {}), cv: me?.resume?.name || null, tailoredCv: !!me?.resume?.tailored};
  const letter = coverLetter || ai?.cover_letter || '';
  const summary = await inPage(tab.id, (list, profile, resume, letter, consents) => window.__jobPilottoExtensionFill(list, profile, resume, letter, consents),
    [answers, me?.contact || config.profile || {}, me?.resume || config.resume || null, letter, config.acceptConsents === true]);
  const armedLeft = () => inPage(tab.id, () => window.__jobPilottoArmedCount?.() || 0);
  step('filled the page');
  const clickDropdowns = config.clickDropdowns !== false;  // on unless turned off in Settings
  if (!clickDropdowns && await armedLeft()) {
    // Say why they're left, and how to have them chosen automatically.
    summary.todo = [...(summary.todo || []), 'Tip: turn on "Fill drop-down menus too" in the extension Settings to have these chosen for you'];
    await inPage(tab.id, s => window.__jobPilottoPanel(s), [summary]);
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
        await inPage(tab.id, s => window.__jobPilottoPanel(s), [summary]);
      }
    } catch (error) {
      debug.errors.push(`dropdowns: ${error.message}`);
      summary.todo = [`Drop-downs not chosen automatically (${error.message}): click each highlighted one`, ...(summary.todo || [])];
      await inPage(tab.id, s => window.__jobPilottoPanel(s), [summary]);
    }
  }
  event('fill-done', {filled: summary.filled || 0, left: (summary.todo || []).length});
  // One row in 🎏 Job Apply — Agent Runs (Agent = Extension), comparable with the agent runs there.
  api(config, '/extension/run', {method: 'POST', body: JSON.stringify({url: job, started: startedAt.toISOString(),
    ended: new Date().toISOString(), fields: summary.filled || 0, unfilled: summary.unfilledRequired || 0, usd: ai?.usd || 0,
    kit: withKit, todo: (summary.todo || []).slice(0, 8), trace: summary.trace || [], debug: {...debug, aiUsd: ai?.usd || 0}})})
    .then(logged => logged?.url && chrome.storage.session.set({[`run:${tab.id}`]: logged.url})).catch(() => {});
  return {...summary, usd: ai?.usd, aiError, coverLetter: ai?.cover_letter};
}
