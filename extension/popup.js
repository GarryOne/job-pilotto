// Popup: fill the job page you're on (with AI, or from the drafted kit only), mark it Applied,
// and open the next job from the Ready to apply list. Nothing runs on a page until you click here.
import {api, fillTab, settings} from './flow.js';

const $ = id => document.getElementById(id);
const config = await settings();
const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
let kit = null;
let jobUrl = null;

$('settings').addEventListener('click', event => { event.preventDefault(); chrome.runtime.openOptionsPage(); });

function status(text, tone = 'muted') {
  $('status').hidden = !text;
  $('status').className = `card ${tone}`;
  $('status').textContent = text || '';
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

function showResult(result) {
  const box = $('result');
  box.hidden = false;
  box.replaceChildren();
  if (result?.error) { box.textContent = result.error; box.className = 'card warn'; return; }
  box.className = 'card';
  const head = document.createElement('div');
  head.className = 'ok';
  head.textContent = `✓ Filled ${result.filled} field(s)${result.resumeAttached ? ' and attached your CV' : ''}.` +
    (result.usd ? ` AI cost $${result.usd.toFixed(3)}.` : '');
  box.append(head);
  if (result.aiError) {
    const warn = document.createElement('div');
    warn.className = 'warn';
    warn.textContent = `AI answers unavailable (${result.aiError}); filled from the drafted kit and your contact details.`;
    box.append(warn);
  }
  if (result.todo?.length) {
    const title = document.createElement('div');
    title.className = 'warn';
    title.style.marginTop = '6px';
    title.textContent = 'Still yours to do (also shown on the page):';
    box.append(title);
    list(box, result.todo);
  }
  const next = document.createElement('div');
  next.className = 'muted';
  next.style.marginTop = '6px';
  next.textContent = 'Multi-page form? Click Next on the page, then Fill again.';
  box.append(next);
}

async function fill(options) {
  for (const id of ['fill-ai', 'fill-kit', 'fill-anyway']) $(id).disabled = true;
  $('ineligible').hidden = true;
  status('Reading the form and filling it…');
  try {
    const result = await fillTab(tab, config, {kitAnswers: kit?.answers || [], ...options});
    status('');
    if (result.ineligible) {
      $('ineligible').hidden = false;
      $('ineligible-note').textContent = `Not filled: ${result.note}`;
    } else {
      showResult(result);
      $('applied').hidden = false;
      if (result.coverLetter && !kit?.cover_letter) { kit = {...(kit || {answers: []}), cover_letter: result.coverLetter}; $('copy-letter').hidden = false; }
    }
  } catch (error) {
    status(/Cannot access|cannot be scripted/i.test(error.message) ? 'Chrome doesn\'t allow extensions on this page.'
      : `Filling failed: ${error.message}`, 'warn');
  } finally {
    for (const id of ['fill-ai', 'fill-kit', 'fill-anyway']) $(id).disabled = false;
    $('fill-ai').textContent = 'Fill again with AI';
  }
}

$('fill-ai').addEventListener('click', () => fill({useAI: true}));
$('fill-kit').addEventListener('click', () => fill({useAI: false}));
$('fill-anyway').addEventListener('click', () => fill({useAI: true, force: true}));

$('copy-letter').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(kit.cover_letter); $('copy-letter').textContent = 'Copied ✓'; }
  catch { status('Copy failed; open the kit in Notion to copy the letter.', 'warn'); }
});

$('applied').addEventListener('click', async () => {
  $('applied').disabled = true;
  try {
    const data = await api(config, '/extension/applied', {method: 'POST', body: JSON.stringify({url: jobUrl || tab.url})});
    $('applied').textContent = '✓ ' + data.message;
  } catch (error) {
    $('applied').disabled = false;
    status(`Couldn't mark it Applied: ${error.message}`, 'warn');
  }
});

async function loadQueue() {
  try {
    const {jobs} = await api(config, '/extension/queue');
    if (!jobs.length) return;
    $('queue').hidden = false;
    $('queue-count').textContent = `· ${jobs.length} with a drafted kit`;
    for (const job of jobs.slice(0, 8)) {
      const row = document.createElement('div');
      row.className = 'queue-row';
      const text = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = job.title;
      const company = document.createElement('div');
      company.className = 'muted';
      company.textContent = job.company;
      text.append(title, company);
      const open = document.createElement('button');
      open.className = 'secondary small';
      open.textContent = 'Open & fill';
      open.addEventListener('click', async () => {
        // The job sites are granted at install (manifest host_permissions); asking here closed the popup
        // before the answer came back, so the button did nothing.
        await chrome.runtime.sendMessage({type: 'openAndFill', url: job.url});
        window.close();
      });
      row.append(text, open);
      $('queue-list').append(row);
    }
  } catch { /* the queue is a convenience; the page actions still work */ }
}

async function load() {
  if (!config.workerUrl || !config.token) {
    status('Open Settings and add your Worker URL and extension token first.', 'warn');
    return;
  }
  const onPage = /^https?:/.test(tab?.url || '');
  if (onPage) {
    $('actions').hidden = false;
    try {
      const data = await api(config, `/extension/kit?url=${encodeURIComponent(tab.url)}`);
      $('job').hidden = false;
      $('job-title').textContent = data.job.title || 'Untitled job';
      $('job-company').textContent = data.job.company || '';
      $('job-stage').textContent = data.job.stage || 'No stage';
      kit = data.kit;
      jobUrl = data.job.url || tab.url;
      $('job-answers').textContent = kit ? `${kit.answers.length} drafted answers` : 'no kit yet';
      $('fill-kit').hidden = !kit;
      $('copy-letter').hidden = !kit?.cover_letter;
      $('applied').hidden = false;
    } catch (error) {
      $('fill-kit').hidden = true;
      if (error.status === 401) status('The extension token was rejected. Check it in Settings.', 'warn');
      else if (error.status !== 404) status(`Couldn't reach your Worker: ${error.message}`, 'warn');
      // 404: a job that isn't tracked yet can still be filled with AI.
    }
  }
  loadQueue();
}

load();
