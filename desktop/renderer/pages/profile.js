// Settings → Application profile.
import {openInNotion, showNotionPanel} from './notion-connect.js';
import {el, pill, tile} from '../components.js';
import {icon} from '../icons.js';
import {shared} from './shared.js';
import {showCloud, showExtensionStatus, showGoogle, showSchedule} from './connections.js';
import {$, message, osText, runWhen, show} from './core.js';
import {showCvChanged} from './cv-change.js';
import {renderOverview} from './settings.js';
import {goStep} from './wizard.js';
import {showEngineSettings} from './ai-engine.js';

// ---------- Settings → Application profile: tabs (CV & details, Standard answers) ----------
export function profileTab(name) {
  document.querySelectorAll('[data-profile-tab]').forEach(tab => tab.classList.toggle('is-active', tab.dataset.profileTab === name));
  document.querySelectorAll('[data-profile-panel]').forEach(panel => {
    if (panel.id === 'cv-changed') return;  // shown only when the CV changed (showCvChanged)
    show(panel, panel.dataset.profilePanel === name);
  });
  if (name === 'answers') loadAnswers();
  else if (name === 'letter') loadLetter();
  else { loadCvSetting(); showCvChanged(); }
}
// ---------- Settings → Profile → Cover letter: AI draft -> the user reviews, edits, approves -> PDF ----------
let letterSaved = '';  // the text as stored: the buttons follow what differs from it
function showLetter(status) {
  letterSaved = status.text || '';
  $('letter-text').value = letterSaved;
  const approved = status.state === 'approved';
  const label = {none: 'Not written yet', draft: 'Draft: read it, then approve', approved: `Approved ✓ ${status.approvedAt ? runWhen(status.approvedAt) : ''}`}[status.state] || '';
  const state = $('letter-state');
  state.textContent = label;
  state.classList.toggle('is-on', approved);
  $('letter-draft').querySelector('span').textContent = status.text ? 'Write a new one' : 'Write it with AI';
  show($('letter-pdf'), status.pdf);
  letterButtons();
}
function letterButtons() {
  const text = $('letter-text').value.trim();
  $('letter-save').disabled = !text || text === letterSaved.trim();
  $('letter-approve').disabled = !text || ($('letter-state').classList.contains('is-on') && text === letterSaved.trim());
}
async function loadLetter() { showLetter(await window.pilot.coverLetter()); }
async function letterAction(button, working, run) {
  const buttons = ['letter-draft', 'letter-save', 'letter-approve'].map($);
  buttons.forEach(b => { b.disabled = true; });
  button.classList.add('busy');
  message('letter-message', working);
  const result = await run();
  button.classList.remove('busy');
  if (result.ok) showLetter(result); else { letterButtons(); }
  $('letter-draft').disabled = false;
  return result;
}
function initLetter() {
  $('letter-text').addEventListener('input', letterButtons);
  $('letter-draft').addEventListener('click', async () => {
    if ($('letter-text').value.trim() && $('letter-text').value.trim() !== letterSaved.trim() && !confirm('Replace the text you changed with a new draft?')) return;
    const feedback = $('letter-feedback').value.trim();
    const result = await letterAction($('letter-draft'), 'Writing your letter… (about 20 s)', () => window.pilot.coverLetterDraft(feedback));
    if (result.ok) $('letter-feedback').value = '';
    message('letter-message', result.ok ? 'Here is a draft. Read it, change what you like, then approve.' : result.error, result.ok ? 'ok' : 'error');
  });
  $('letter-save').addEventListener('click', async () => {
    const result = await letterAction($('letter-save'), 'Saving…', () => window.pilot.coverLetterSave($('letter-text').value));
    message('letter-message', result.ok ? 'Saved as a draft. Approve it to make the PDF.' : result.error, result.ok ? 'ok' : 'error');
  });
  $('letter-approve').addEventListener('click', async () => {
    const result = await letterAction($('letter-approve'), 'Making the PDF…', () => window.pilot.coverLetterApprove($('letter-text').value));
    message('letter-message', result.ok ? 'Approved ✓ Forms that ask for a cover letter file get this PDF.' : result.error, result.ok ? 'ok' : 'error');
  });
  $('letter-pdf').addEventListener('click', () => window.pilot.coverLetterOpen());
}
// Professional links: shown as tiles; Edit shows the fields (saved with the details' Save changes).
function showLinks() {
  const value = name => document.querySelector(`[data-contact="${name}"]`).value.trim();
  $('links-view').replaceChildren(...[['linkedin', 'LinkedIn', 'user'], ['github', 'GitHub', 'bot'], ['website', 'Website', 'link']].map(([key, name, glyph]) => {
    const box = el('div', 'link-tile');
    const text = el('span');
    text.append(el('b', '', name), el('span', 'muted small', value(key).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') || 'Not added'));
    box.append(tile(glyph, 'neutral'), text);
    return box;
  }));
}
// Standard answers: read from Notion, one expandable item per question; edits happen in Notion.
async function loadAnswers() {
  $('answers-list').replaceChildren(el('p', 'muted small', 'Loading from Notion…'));
  const result = await window.pilot.standardAnswers();
  if (!result.ok) { $('answers-list').replaceChildren(el('p', 'message error', result.error)); return; }
  const items = result.groups.flatMap(group => group.items.map(item => ({...item, category: group.category})));
  $('answers-count').textContent = `${items.length} standard answer${items.length === 1 ? '' : 's'}${items.some(item => item.open) ? ` · ${items.filter(item => item.open).length} need your answer` : ''}`;
  $('answers-list').replaceChildren(...items.map((item, index) => {
    const box = document.createElement('details');
    box.className = 'answer-item';
    box.open = index === 0;
    const summary = document.createElement('summary');
    const head = el('span', 'answer-head');
    head.append(el('b', '', item.question), pill(item.open ? 'Needs your answer' : item.category, item.open ? 'warn' : 'info'));
    const edit = el('button', 'link', 'Edit in Notion');
    edit.addEventListener('click', event => { event.preventDefault(); openInNotion('NOTION_ANSWERS_PAGE_ID', event); });
    summary.append(head, el('span', 'muted answer-preview', item.answer.split('\n')[0]), edit);
    box.append(summary, el('p', 'answer-text', item.answer || '—'));
    return box;
  }));
}

// Sidebar: the Notion pages, most used first. Click opens them in the app's Notion window; ⌘-click in the browser.
const NOTION_LINKS = [['NOTION_MATCHES_DB', 'Job matches', 'target'], ['NOTION_APPLICATIONS_DB', 'Applications', 'layers'],
  ['NOTION_EVENTS_DB', 'Replies & events', 'mail'], ['NOTION_INTERVIEWS_DB', 'Interviews', 'mic'], ['NOTION_INSIGHTS_DB', 'Insights', 'chart'],
  ['NOTION_PIPELINE_PAGE', 'Pipeline', 'columns'], ['NOTION_PROFILE_PAGE_ID', 'Profile', 'user'], ['NOTION_ANSWERS_PAGE_ID', 'Standard answers', 'file'],
  ['NOTION_SEARCH_SETTINGS_PAGE', 'Search settings', 'settings'], ['NOTION_KNOWLEDGE_PAGE', 'Form knowledge', 'bookmark'],
  ['NOTION_EMPLOYERS_DB', 'Employers', 'building'], ['NOTION_CRON_RUNS_DB', 'Search runs', 'search'], ['NOTION_AGENT_RUNS_DB', 'Form fills', 'bot']];
function renderNotionLinks() {
  const box = $('notion-links');
  box.querySelectorAll('.notion-link').forEach(link => link.remove());
  const links = NOTION_LINKS.filter(([env]) => shared.state.notion?.[env]);
  show(box, links.length > 0);
  for (const [env, label, glyph] of links) {
    const link = Object.assign(document.createElement('button'), {className: 'notion-link', textContent: label,
      title: osText(`${shared.state.notionTitles?.[env] || label}: opens in Notion (⌘-click: in a Job Pilotto window)`)});
    link.prepend(icon(glyph));
    link.addEventListener('click', event => window.pilot.openNotion(shared.state.notion[env], event.metaKey || event.ctrlKey));
    box.append(link);
  }
}

export async function loadCvSetting() {
  const status = await window.pilot.cvStatus();
  // One glance: ready (and which design), or not read yet. ✂️ Tailor CV on a job uses it.
  $('cv-state').textContent = status.base ? `· ready · ${status.custom ? 'your design' : 'default design'}` : '· not read yet: it happens on your first Tailor CV';
  $('cv-view').hidden = !status.base;
  $('cv-import').querySelector('span').textContent = status.base ? 'Read my CV PDF again' : 'Read my CV PDF';
}

export async function loadSettings() {
  shared.state = await window.pilot.state();
  showNotionPanel();
  const hints = await window.pilot.secretHints();
  for (const [id, name, empty] of [['set-anthropic', 'ANTHROPIC_API_KEY', 'sk-ant-…'], ['set-notion', 'NOTION_TOKEN', 'ntn_…'],
    ['set-telegram', 'TELEGRAM_BOT_TOKEN', '123456789:AA…'], ['set-serpapi', 'SERPAPI_API_KEY', 'SerpApi key']]) {
    if ($(id)) $(id).placeholder = hints[name] ? `${hints[name]} · saved (paste a new one to replace it)` : empty;
  }
  renderNotionLinks();
  showEngineSettings();
  showCloud();
  showSchedule();
  showContact();
  $('claude-consent').checked = !!shared.state.settings.claudeConsent;
  document.querySelectorAll('[data-secret]').forEach(line => {
    const set = shared.state.secrets[line.dataset.secret];
    line.textContent = set ? '✓ Connected' : 'Not set';
    line.classList.toggle('on', set);
  });
  showGoogle();
  const ext = await window.pilot.extensionInfo();
  showExtensionStatus();
  $('ext-url').textContent = ext.url;
  $('ext-token').textContent = ext.token;
  $('data-folder').textContent = shared.state.folder;
  $('auto-search').checked = shared.state.settings.autoSearch !== false;
  $('open-login').checked = !!shared.state.settings.openAtLogin;
  $('last-search').textContent = shared.state.settings.lastSearchAt
    ? `${runWhen(shared.state.settings.lastSearchAt)}${shared.state.settings.lastSearchOk === false ? ' (with problems)' : ''}`
    : 'No search yet';
  if (shared.state.settings.telegramBot && shared.state.secrets.TELEGRAM_BOT_TOKEN) {
    const line = document.querySelector('[data-secret="TELEGRAM_BOT_TOKEN"]');
    line.textContent = `✓ Connected to @${shared.state.settings.telegramBot}`;
  }
  renderOverview().catch(() => {});
}
// ---------- your details for application forms (the extension asks the app for them) ----------
export function showContact() {
  window.pilot.contact().then(contact => {
    document.querySelectorAll('[data-contact]').forEach(input => { input.value = contact[input.dataset.contact] || ''; });
    showLinks();
  }).catch(error => message('contact-message', `Couldn't read them from Notion: ${error.message}`, 'error'));
  $('contact-cv').textContent = shared.state.settings.cvName || 'None yet';
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  initLetter();
  document.querySelectorAll('[data-profile-tab]').forEach(tab => tab.addEventListener('click', () => profileTab(tab.dataset.profileTab)));
  $('open-profile-details').addEventListener('click', event => openInNotion('NOTION_PROFILE_PAGE_ID', event));
  $('answers-review').addEventListener('click', event => openInNotion('NOTION_ANSWERS_PAGE_ID', event));
  $('links-edit').addEventListener('click', () => {
    const editing = $('links-form').hidden;
    show($('links-form'), editing);
    show($('links-view'), !editing);
    $('links-edit').textContent = editing ? 'Done' : 'Edit';
    if (!editing) showLinks();
  });
  $('open-profile').addEventListener('click', event => openInNotion('NOTION_PROFILE_PAGE_ID', event));
  $('open-answers').addEventListener('click', event => openInNotion('NOTION_ANSWERS_PAGE_ID', event));
  renderNotionLinks();
  $('strategy-redo').addEventListener('click', () => { shared.rebuildAsked = true; show($('app'), false); show($('wizard')); goStep('cv'); });
  $('cv-view').addEventListener('click', async () => {
    const result = await window.pilot.viewBaseCv();
    $('cv-message').textContent = !result.ok ? result.error : result.overflow?.length ? `Page ${result.overflow.join(', ')} is too full: its end is cut off.` : '';
  });
  $('cv-import').addEventListener('click', async () => {
    if ((await window.pilot.cvStatus()).base && !confirm('Replace your CV data (and any hand edits) with a fresh read of your CV PDF?')) return;
    const button = $('cv-import');
    button.disabled = true;
    button.classList.add('busy');
    $('cv-message').textContent = 'Reading your CV… (about 30 s)';
    const result = await window.pilot.importCv();
    button.disabled = false;
    button.classList.remove('busy');
    $('cv-message').textContent = result.ok ? `Done ($${result.usd.toFixed(2)}).` : result.error;
    loadCvSetting();
  });
  $('cv-folder').addEventListener('click', () => window.pilot.showCvFolder());
  $('set-telegram-save').addEventListener('click', async () => {
    const value = $('set-telegram').value.trim();
    if (!/^\d+:[\w-]{30,}$/.test(value)) { message('telegram-message', 'That doesn\'t look like a bot token (numbers, a colon, then letters).', 'error'); return; }
    $('set-telegram-save').disabled = true;
    message('telegram-message', 'Checking the token…');
    const result = await window.pilot.telegramConnect(value);
    $('set-telegram-save').disabled = false;
    if (!result.ok) { message('telegram-message', result.error, 'error'); return; }
    $('set-telegram').value = '';
    message('telegram-message', `Connected to @${result.username} ✓ Matches arrive there after each search.`, 'ok');
    loadSettings();
  });
  $('contact-save').addEventListener('click', async () => {
    const field = name => document.querySelector(`[data-contact="${name}"]`);
    // Full name isn't shown: forms that ask for it get first + last.
    const first = field('first_name').value.trim(), last = field('last_name').value.trim();
    if (first && last) field('full_name').value = `${first} ${last}`;
    const contact = Object.fromEntries([...document.querySelectorAll('[data-contact]')]
      .map(input => [input.dataset.contact, input.value.trim()]).filter(([, value]) => value));
    $('contact-save').disabled = true;
    const result = await window.pilot.saveContact(contact);
    if (!result.ok) $('contact-save').disabled = false;
    message('contact-message', result.ok ? (shared.state.notion ? 'Saved in your Notion Profile ✓ The extension uses these from the next form it fills.'
      : 'Saved ✓ The extension uses these from the next form it fills.') : result.error, result.ok ? 'ok' : 'error');
  });
}
