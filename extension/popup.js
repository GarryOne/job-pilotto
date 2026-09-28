// Popup: the job page you're on only: fill it (with AI, or from the drafted kit only) and mark it Applied. Which
// job to apply to next is the desktop app's job. Nothing runs on a page until you click here.
import {api, cachedAI, fillTab, forgetAI, settings} from './flow.js';

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
  for (const id of ['fill', 'fill-anyway']) $(id).disabled = true;
  $('ineligible').hidden = true;
  const started = Date.now();
  let step = 'Reading the form…';
  const tick = () => status(`${step} ${Math.round((Date.now() - started) / 1000)} s`, 'busy');
  tick();
  const timer = setInterval(tick, 1000);
  try {
    const result = await fillTab(tab, config, {jobUrl, kitAnswers: kit?.answers || [], coverLetter: kit?.cover_letter || '', ...options, onStep: text => { step = text; tick(); }});
    clearInterval(timer);
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
    clearInterval(timer);
    status(/Cannot access|cannot be scripted/i.test(error.message) ? 'Chrome doesn\'t allow extensions on this page.'
      : `Filling failed: ${error.message}`, 'warn');
  } finally {
    for (const id of ['fill', 'fill-anyway']) $(id).disabled = false;
    $('fill').textContent = 'Fill again';
  }
}

// One way to fill, the best one (flow.js fillTab): the kit's answers, then Claude only for what they don't cover.
// "Fill again" (after the form changed, or a next page) reads it afresh.
$('fill').addEventListener('click', async () => {
  if ($('fill').textContent.startsWith('Fill again')) await forgetAI(tab);
  fill({useAI: true});
});
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

async function load() {
  if (!config.workerUrl || !config.token) {
    status('Open Settings and add your Worker URL and extension token first.', 'warn');
    return;
  }
  const onPage = /^https?:/.test(tab?.url || '');
  if (config.testMode) status('Test mode is on: every field gets filled, with dummy values where unsure. Turn it off in Settings for real applications.', 'warn');
  if (onPage) {
    $('actions').hidden = false;
    try {
      // A form reached from a job board's Apply belongs to the posting that tab came from.
      const from = (await chrome.storage.session.get(`from:${tab.id}`))[`from:${tab.id}`];
      const data = await api(config, `/extension/kit?url=${encodeURIComponent(from || tab.url)}`);
      $('job').hidden = false;
      $('job-title').textContent = data.job.title || 'Untitled job';
      $('job-company').textContent = data.job.company || '';
      $('job-stage').textContent = data.job.stage || 'No stage';
      kit = data.kit;
      jobUrl = data.job.url || from || tab.url;
      $('job-answers').textContent = kit ? `${kit.answers.length} drafted answers` : 'no kit yet';
      $('copy-letter').hidden = !kit?.cover_letter;
      $('applied').hidden = false;
    } catch (error) {
      if (error.status === 401) status('The extension token was rejected. Check it in Settings.', 'warn');
      else if (error.status !== 404) status(`Couldn't reach your Worker: ${error.message}`, 'warn');
      // 404: a job that isn't tracked yet can still be filled with AI.
    }
    // Already checked on this page (an automatic fill, or an earlier click): show that result now.
    const known = await cachedAI(tab);
    if (known && !known.eligible && config.checkEligibility !== false) {
      $('ineligible').hidden = false;
      $('ineligible-note').textContent = `Not filled: ${known.eligibility_note}`;
    }
  }
}

load();

// The latest fill of this tab, recorded in Notion's Form fills (Agent Runs): field by field, learnings, debug data.
async function showRunLink() {
  if (!tab?.id) return;
  const key = `run:${tab.id}`;
  const url = (await chrome.storage.session.get(key))[key];
  if (!url) return;
  $('run-log').hidden = false;
  $('run-log').onclick = event => { event.preventDefault(); chrome.tabs.create({url}); };
}
showRunLink();
chrome.storage.session.onChanged.addListener(changes => { if (tab?.id && changes[`run:${tab.id}`]) showRunLink(); });
