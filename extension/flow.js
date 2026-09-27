// One fill run on a tab: read the form, get answers (AI and/or the drafted kit), fill, report.
// Shared by the popup (the tab you're on) and the background worker ("Open & fill" from the queue).
export const JOB_SITES = [
  'https://*.greenhouse.io/*', 'https://jobs.lever.co/*', 'https://jobs.ashbyhq.com/*',
  'https://*.myworkdayjobs.com/*', 'https://*.smartrecruiters.com/*', 'https://apply.workable.com/*',
];

export async function settings() {
  return chrome.storage.local.get(['workerUrl', 'token', 'profile', 'resume']);
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
export async function fillTab(tab, config, {useAI = true, force = false, kitAnswers = []} = {}) {
  await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN',
    files: ['page/browser-submit-guard.js', 'page/browser-form-fastpath.js', 'page/fill.js']});
  let answers = kitAnswers.map(a => ({field: a.field, value: a.answer, question: a.question,
    confidence: a.needs_review ? 'low' : 'high'}));
  let ai = null, aiError = null;
  if (useAI) {
    const form = await inPage(tab.id, () => window.__jobPilottoDescribeForm());
    const open = (form || []).filter(f => !f.filled && !f.legal).map(({field, label, type, required, options}) =>
      ({field, label, type, required, options}));
    if (open.length) {
      try {
        const pageText = await inPage(tab.id, () => window.__jobPilottoPageText());
        ai = await api(config, '/extension/answer', {method: 'POST',
          body: JSON.stringify({url: tab.url, fields: open, page_text: pageText})});
        if (!ai.eligible && !force) return {ineligible: true, note: ai.eligibility_note, usd: ai.usd};
        // The AI saw the live form, so its answer wins; kit answers fill whatever it left out.
        const byAI = new Set(ai.answers.map(a => a.field));
        answers = [...ai.answers, ...answers.filter(a => !byAI.has(a.field))];
      } catch (error) {
        aiError = error.message;
      }
    }
  }
  // Contact details and CV come from the Job Pilotto app each time (it's the one place they live).
  const me = await api(config, '/extension/me').catch(() => null);
  const summary = await inPage(tab.id, (list, profile, resume) => window.__jobPilottoExtensionFill(list, profile, resume),
    [answers, me?.contact || config.profile || {}, me?.resume || config.resume || null]);
  return {...summary, usd: ai?.usd, aiError, coverLetter: ai?.cover_letter};
}
