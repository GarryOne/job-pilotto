// One fill run on a tab: read the form, get answers (AI and/or the drafted kit), fill, report.
// Shared by the popup (the tab you're on) and the background worker ("Open & fill" from the queue).
export const JOB_SITES = [
  'https://*.greenhouse.io/*', 'https://jobs.lever.co/*', 'https://jobs.ashbyhq.com/*',
  'https://*.myworkdayjobs.com/*', 'https://*.smartrecruiters.com/*', 'https://apply.workable.com/*',
];

export async function settings() {
  return chrome.storage.local.get(['workerUrl', 'token', 'profile', 'resume', 'checkEligibility', 'testMode']);
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

export async function fillTab(tab, config, {useAI = true, force = false, kitAnswers = [], onStep = () => {}, reuse = true} = {}) {
  onStep('Reading the form…');
  await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN',
    files: ['page/browser-submit-guard.js', 'page/browser-form-fastpath.js', 'page/fill.js']});
  let answers = kitAnswers.map(a => ({field: a.field, value: a.answer, question: a.question,
    confidence: a.needs_review ? 'low' : 'high'}));
  let ai = null, aiError = null;
  if (useAI) {
    const form = await inPage(tab.id, () => window.__jobPilottoDescribeForm());
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
      answers = [...ai.answers, ...answers.filter(a => !byAI.has(a.field))];
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
        answers = [...ai.answers, ...answers.filter(a => !byAI.has(a.field))];
      } catch (error) {
        aiError = error.message;
      }
    }
  }
  onStep('Filling the form…');
  // Contact details and CV come from the Job Pilotto app each time (it's the one place they live).
  const me = await api(config, '/extension/me').catch(() => null);
  const summary = await inPage(tab.id, (list, profile, resume) => window.__jobPilottoExtensionFill(list, profile, resume),
    [answers, me?.contact || config.profile || {}, me?.resume || config.resume || null]);
  return {...summary, usd: ai?.usd, aiError, coverLetter: ai?.cover_letter};
}
