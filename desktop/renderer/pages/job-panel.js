// Jobs → a job's page beside the list (owner's mockup, 9 Oct 2026): the title, "Applied 1 Oct · Zurich · 🎯 82", tabs for what the job
// has (Kit, Prep, Review, Record, Messages, Description, History) and the tab's content, read from the store (IPC jobPage,
// lib/job-page-handlers.js), so it is the same on every store. "Open in Notion" only when the store has pages (links). While it is open
// the list shows its compact rows. Parts: the tabs (.tabs), the interview review's groups (.iv-moments-group, .iv-moment). Parsing:
// renderer/job-page-view.js (tested). Guards: test/job-page-view.test.js, test/job-panel.test.js.
import {el} from '../components.js';
import {icon} from '../icons.js';
import {allAnswers, headerFacts, interviewFacts, pageParts} from '../job-page-view.js';
import {$} from './core.js';

const state = {url: '', tab: '', density: null, asked: 0};
export const panelUrl = () => state.url;

function copyButton(text, label = 'Copy') {
  const button = Object.assign(el('button', 'link', label), {type: 'button', title: 'Copy to the clipboard'});
  button.addEventListener('click', () => navigator.clipboard.writeText(text).then(() => {
    button.textContent = 'Copied ✓';
    setTimeout(() => { button.textContent = label; }, 1500);
  }));
  return button;
}

// A line of a section (job-page-view.js lineOf): bold when it is a question or a label, a to-do with its state, a fold (a Notion toggle:
// "📧 Full message") as the interview review's folded transcript (details.troubleshoot).
function lineView(line) {
  if (typeof line === 'string') return el('div', 'iv-moment', line);
  if (line.fold !== undefined) {
    const fold = el('details', 'troubleshoot');
    fold.append(el('summary', '', line.fold), ...line.lines.map(lineView));
    return fold;
  }
  const text = line.todo === null ? line.text : `${line.todo ? '☑' : '☐'} ${line.text}`;
  return line.strong ? el('div', 'iv-moment', el('b', '', text)) : el('div', `iv-moment${line.quote ? ' muted' : ''}`, text);
}

// A group: its heading (with an optional button on the right) and one .iv-moment per line.
function group(title, lines, action = null) {
  const box = el('div', 'iv-moments-group');
  const head = el('h3', '', title);
  if (action) head.append(action);
  if (title) box.append(head);
  box.append(...lines.map(line => (line instanceof Node ? line : lineView(line))));
  return box;
}

function kitView(kit) {
  if (kit.groups) return kit.groups.map(part => group(part.title, part.lines));
  const parts = [];
  if (kit.intro) parts.push(el('p', 'muted small', kit.intro));
  if (kit.ineligible) parts.push(el('div', 'callout tone-bad', `Not eligible: ${kit.ineligible}`));
  if (kit.check.length) parts.push(group('⚠️ Check before sending', kit.check));
  if (kit.lead.length) parts.push(group('💡 Lead with', kit.lead));
  if (kit.letter) parts.push(group('✉️ Cover letter', kit.letter.split(/\n\s*\n/).map(text => el('div', 'iv-moment', text)), copyButton(kit.letter)));
  if (kit.answers.length) {
    parts.push(group('🧾 Form answers', kit.answers.map(item => {
      const row = el('div', 'iv-moment');
      const line = el('div', 'job-panel-line');
      line.append(el('span', '', item.answer || '—'), copyButton(item.answer));
      row.append(el('b', '', item.review ? `${item.question} ❓` : item.question), line);
      return row;
    }), copyButton(allAnswers(kit.answers), 'Copy all')));
  }
  return parts;
}

function historyView(items) {
  return [group('', items.map(item => {
    const row = el('div', 'iv-moment');
    row.append(el('b', '', `${item.when} · ${item.kind}`), ...(item.note ? [el('span', 'muted', item.note)] : []));
    return row;
  }))];
}

// The job's screenshots (lib/store/files.js), as the composer's attachment rows; View shows one at full width in the panel.
function shotsView(shots) {
  if (!shots.length) return [];
  return [group('Screenshots', shots.map(shot => {
    const row = el('div', 'attachment');
    const view = Object.assign(el('button', 'soft-button', shot.url ? 'View' : 'Too large to show'), {type: 'button', disabled: !shot.url});
    view.addEventListener('click', () => {
      const open = row.nextElementSibling?.classList.contains('job-panel-shot');
      if (open) { row.nextElementSibling.remove(); view.textContent = 'View'; return; }
      row.after(Object.assign(el('img', 'job-panel-shot'), {src: shot.url, alt: shot.name}));
      view.textContent = 'Hide';
    });
    row.append(...(shot.url ? [Object.assign(el('img'), {src: shot.url, alt: ''})] : []), el('span', 'attachment-name', shot.name), view);
    return row;
  }))];
}

function body(parts, tab) {
  if (tab === 'kit') return kitView(parts.kit);
  if (tab === 'messages') return [...(parts.groups.messages || []).map(part => group(part.title, part.lines)), ...shotsView(parts.shots)];
  if (tab === 'history') return historyView(parts.history);
  return (parts.groups[tab] || []).map(part => group(part.title, part.lines));
}

function draw(job, page) {
  const panel = $('job-panel');
  const close = Object.assign(el('button', 'ghost icon-btn'), {type: 'button', title: 'Close the job page'});
  close.setAttribute('aria-label', close.title);
  close.append(icon('close'));
  close.addEventListener('click', closeJobPanel);
  const head = el('div', 'job-panel-head');
  const words = el('div', '');
  words.append(el('h2', '', `${job.title} · ${job.company}`), el('p', 'muted small', headerFacts(job, page?.app)));
  const calls = interviewFacts(page?.app);
  if (calls) words.append(el('p', 'muted small', calls));
  head.append(words, close);
  if (!page) { panel.replaceChildren(head, el('span', 'skeleton w-80'), el('span', 'skeleton w-60'), el('span', 'skeleton w-40')); return; }
  if (page.error) { panel.replaceChildren(head, el('p', 'muted', `Could not read this job: ${page.error}. Close and open it again.`)); return; }
  const parts = pageParts(page);
  const extra = [];
  if (page.links && job.notion_url) {
    const open = Object.assign(el('button', 'link', 'Open in Notion ↗'), {type: 'button'});
    open.addEventListener('click', event => window.pilot.openNotion(job.notion_url, event.metaKey));
    extra.push(open);
  }
  if (!parts.tabs.length) {
    panel.replaceChildren(head, ...extra, el('p', 'muted', page.app ? 'Nothing saved on this job yet: its kit, messages, reviews and history show here as they come.'
      : 'Not tracked yet: Apply drafts its kit, Save keeps it; what follows shows here.'));
    return;
  }
  if (!parts.tabs.some(([key]) => key === state.tab)) state.tab = parts.tabs[0][0];
  const tabs = el('div', 'tabs');
  tabs.setAttribute('role', 'tablist');
  for (const [key, label] of parts.tabs) {
    const button = Object.assign(el('button', key === state.tab ? 'is-active' : '', label), {type: 'button'});
    Object.assign(button.dataset, {jobTab: key});
    button.setAttribute('role', 'tab');
    button.addEventListener('click', () => { state.tab = key; draw(job, page); });
    tabs.append(button);
  }
  panel.replaceChildren(head, ...extra, tabs, ...body(parts, state.tab));
}

// Opens (or switches) the panel on a job; `tab` picks a tab when the job has it (a kit chip opens Kit).
export async function openJobPanel(job, tab = '') {
  const split = $('jobs-split'), list = $('jobs-body');
  if (state.density === null) state.density = list.classList.contains('compact');
  state.tab = tab || (state.url === job.url ? state.tab : '');   // the same job keeps its tab
  state.url = job.url;
  split.classList.add('has-panel');
  list.classList.add('compact');
  $('jobs-head').hidden = true;
  for (const row of list.querySelectorAll('.job-row')) row.classList.toggle('is-selected', row.dataset.url === job.url);
  $('job-panel').hidden = false;
  draw(job, null);
  const asked = ++state.asked;
  const page = await window.pilot.jobPage(job.url).catch(error => ({error: error.message}));
  if (asked === state.asked && state.url === job.url) draw(job, page);   // a later click wins
}

export function closeJobPanel() {
  if (!state.url) return;
  state.url = '';
  state.asked++;
  $('jobs-split').classList.remove('has-panel');
  $('job-panel').hidden = true;
  $('jobs-body').classList.toggle('compact', !!state.density);
  $('jobs-head').hidden = !!state.density;
  state.density = null;
  for (const row of $('jobs-body').querySelectorAll('.job-row.is-selected')) row.classList.remove('is-selected');
}
