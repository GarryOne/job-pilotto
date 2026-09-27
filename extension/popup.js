// Popup: find this page's job and kit through the Worker, fill the form in the page, mark Applied.
// Uses only activeTab + scripting: nothing runs on a page until you open the popup there.
const $ = id => document.getElementById(id);
const settings = await chrome.storage.local.get(['workerUrl', 'token', 'profile']);
const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
let kit = null;
let jobUrl = null;

$('settings').addEventListener('click', event => { event.preventDefault(); chrome.runtime.openOptionsPage(); });

function status(text, tone = 'muted') {
  const box = $('status');
  box.hidden = !text;
  box.className = `card ${tone}`;
  box.textContent = text || '';
}

function list(parent, items) {
  const ul = document.createElement('ul');
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.append(li);
  }
  parent.append(ul);
}

async function api(path, init = {}) {
  const response = await fetch(`${settings.workerUrl.replace(/\/$/, '')}${path}`, {
    ...init, headers: {Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json', ...(init.headers || {})},
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), {status: response.status, data});
  return data;
}

async function load() {
  if (!settings.workerUrl || !settings.token) {
    status('Open Settings and add your Worker URL and extension token first.', 'warn');
    return;
  }
  if (!/^https?:/.test(tab?.url || '')) { status('Open a job application page, then click Job Pilotto again.'); return; }
  try {
    const data = await api(`/extension/kit?url=${encodeURIComponent(tab.url)}`);
    status('');
    $('job').hidden = false;
    $('job-title').textContent = data.job.title || 'Untitled job';
    $('job-company').textContent = data.job.company || '';
    $('job-stage').textContent = data.job.stage || 'No stage';
    kit = data.kit;
    jobUrl = data.job.url || tab.url;
    $('job-answers').textContent = kit ? `${kit.answers.length} drafted answers` : 'no kit yet';
    if (data.job.url && new URL(data.job.url).host !== new URL(tab.url).host) {
      $('open-page').hidden = false;
      $('open-page').href = data.job.url;
      $('open-page').onclick = event => { event.preventDefault(); chrome.tabs.update(tab.id, {url: data.job.url}); window.close(); };
    }
    $('actions').hidden = false;
    $('fill').disabled = !kit;
    if (!kit) status('No kit for this job yet: tap 📝 Prepare under it in Telegram, then reopen this.', 'warn');
    if (kit?.cover_letter) $('copy-letter').hidden = false;
    const review = [...(kit?.answers || []).filter(a => a.needs_review).map(a => `Review: ${a.question}`),
                    ...(kit?.check_before_sending || [])];
    if (review.length) { $('review').hidden = false; list($('review-list'), review); }
  } catch (error) {
    status(error.status === 404 ? 'This job isn\'t in your tracker yet. Save it or prepare a kit from the Telegram digest first.'
      : error.status === 401 ? 'The extension token was rejected. Check it in Settings.'
      : `Couldn't reach your Worker: ${error.message}`, 'warn');
  }
}

$('fill').addEventListener('click', async () => {
  $('fill').disabled = true;
  $('fill').textContent = 'Filling…';
  try {
    await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN',
      files: ['page/browser-submit-guard.js', 'page/browser-form-fastpath.js', 'page/fill.js']});
    const [{result}] = await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN',
      func: (answers, profile) => window.__jobPilottoExtensionFill(answers, profile),
      args: [kit.answers, settings.profile || {}]});
    show(result);
  } catch (error) {
    status(`Filling failed: ${error.message}`, 'warn');
  } finally {
    $('fill').textContent = 'Fill again';
    $('fill').disabled = false;
  }
});

function show(result) {
  const box = $('result');
  box.hidden = false;
  box.replaceChildren();
  if (result?.error) { box.textContent = result.error; box.className = 'card warn'; return; }
  const head = document.createElement('div');
  head.className = 'ok';
  head.textContent = `✓ Filled ${result.filled} field(s)${result.contact ? `, ${result.contact} of them your contact details` : ''}.`;
  box.append(head);
  const todo = [];
  if (result.resumeMissing) todo.push('Upload your CV');
  for (const item of result.toPick) todo.push(`Pick "${item.answer}" for: ${item.question}`);
  for (const label of result.stillRequired) todo.push(`Answer: ${label}`);
  for (const label of result.legalLeft) todo.push(`Your choice (legal): ${label}`);
  if (todo.length) {
    const title = document.createElement('div');
    title.className = 'warn';
    title.style.marginTop = '6px';
    title.textContent = 'Still yours to do:';
    box.append(title);
    list(box, todo);
  }
  if (result.notOnPage) {
    const note = document.createElement('div');
    note.className = 'muted';
    note.style.marginTop = '6px';
    note.textContent = `${result.notOnPage} drafted answer(s) have no matching field on this page (a later step, or the form changed).`;
    box.append(note);
  }
}

$('copy-letter').addEventListener('click', async () => {
  await navigator.clipboard.writeText(kit.cover_letter);
  $('copy-letter').textContent = 'Copied ✓';
});

$('applied').addEventListener('click', async () => {
  $('applied').disabled = true;
  try {
    const data = await api('/extension/applied', {method: 'POST', body: JSON.stringify({url: jobUrl || tab.url})});
    $('applied').textContent = '✓ ' + data.message;
  } catch (error) {
    $('applied').disabled = false;
    status(`Couldn't mark it Applied: ${error.message}`, 'warn');
  }
});

load();
