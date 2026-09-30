// Setup step 5: review the drafted strategy.
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {applyGoal, replaceCell, replaceLine, withLine} from '../markdown-edit.js';
import {shared} from './shared.js';
import {buildDraft, currentAnswers, showSearchStatus} from './activity.js';
import {$, message, osText, readable, show} from './core.js';
import {loadJobs} from './jobs.js';
import {openView} from './nav.js';
import {openSetting} from './settings.js';
import {toastMessage} from './startup.js';
import {goStep, saveState} from './wizard.js';

// ---------- step 5: review the drafted strategy ----------
// The draft's lists, as the cards show them: [draft path, how an entry is shown, how a typed entry is stored].
const escapeFragment = text => text.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LISTS = {
  roles: [['search', 'role_keywords'], readable, escapeFragment],
  places: [['search', 'locations', 'top_tier'], readable, escapeFragment],
  country: [['search', 'locations', 'country_wide'], readable, escapeFragment],
  abroad: [['search', 'locations', 'abroad'], readable, escapeFragment],
  queries: [['search', 'jobs_board_search_queries'], text => text, text => text.trim()],
  languages: [['preferences', 'disqualifying_languages'], text => text, text => text.trim()],
};
const listOf = name => LISTS[name][0].reduce((node, key) => node?.[key], shared.draft) || [];
// Each word capitalised (accents too: "zürich" -> "Zürich"), known acronyms in capitals.
export const titleCase = text => String(text).replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, gap, letter) => gap + letter.toUpperCase())
  .replace(/\b(Aws|Gcp|Sre|Eks|Ecs|Slo|Ci|Cd)\b/g, w => w.toUpperCase());
let draftSavedTimer, editsTimer;
function draftChanged(fields) {
  clearTimeout(editsTimer);
  editsTimer = setTimeout(async () => {
    await window.pilot.cacheDraftEdits(Object.fromEntries(fields.map(field => [field, shared.draft[field]])));
    show($('draft-saved')); clearTimeout(draftSavedTimer);
    draftSavedTimer = setTimeout(() => show($('draft-saved'), false), 2500);
  }, 300);
}
function renderList(name, {limit = 0} = {}) {
  const [, show_, ] = LISTS[name];
  const box = $(`chips-${name}`);
  if (!box) return;
  const items = listOf(name);
  const expanded = box.dataset.expanded === '1';
  const visible = limit && !expanded ? items.slice(0, limit) : items;
  box.replaceChildren(...visible.map((item, i) => {
    const pill = Object.assign(document.createElement('span'), {className: 'chip removable'});
    const label = Object.assign(document.createElement('span'), {textContent: name === 'roles' || name === 'queries' ? titleCase(show_(item)) : titleCase(show_(item))});
    const remove = Object.assign(document.createElement('button'), {className: 'x', textContent: '×', title: 'Remove'});
    remove.addEventListener('click', () => { listOf(name).splice(i, 1); draftChanged(['search', 'preferences']); renderLists(); });
    pill.append(label, remove);
    return pill;
  }));
  if (limit && items.length > limit && !expanded) {
    const more = Object.assign(document.createElement('button'), {className: 'chip more', textContent: `+ ${items.length - limit} more`});
    more.addEventListener('click', () => { box.dataset.expanded = '1'; renderLists(); });
    box.append(more);
  }
  if (!items.length) box.append(Object.assign(document.createElement('span'), {className: 'muted small', textContent: 'None'}));
}
function renderLists() {
  renderList('roles', {limit: 10}); renderList('places', {limit: 6}); renderList('country', {limit: 4});
  renderList('abroad'); renderList('queries', {limit: 8}); renderList('languages');
}

// Markdown (headings, tables, bullets, paragraphs, **bold**) as read-only HTML for the Detailed strategy.
// Values are edited in place: click a cell, a bullet or a paragraph (Enter or click away saves, Esc cancels).
// edit(lineIndex, newLine) puts the change back into the markdown.
function markdownView(markdown, edit) {
  const box = document.createDocumentFragment();
  const inline = text => {
    const span = document.createElement('span');
    text.split(/(\*\*[^*]+\*\*)/).forEach(part => span.append(part.startsWith('**') ? Object.assign(document.createElement('b'), {textContent: part.slice(2, -2)}) : part));
    return span;
  };
  // The element shows the formatted text; while editing, its raw markdown (so **bold** survives).
  const editable = (element, raw, save) => {
    element.classList.add('editable');
    element.title = 'Click to edit';
    element.addEventListener('click', () => {
      if (element.isContentEditable) return;
      element.textContent = raw.trim() === '❓' ? '' : raw;  // an unanswered ❓: start empty
      element.contentEditable = 'plaintext-only';
      element.focus();
      getSelection().selectAllChildren(element); getSelection().collapseToEnd();
      let done = false;
      const finish = keep => {
        if (done) return;
        done = true;
        element.contentEditable = 'false';
        const text = element.textContent;
        if (keep && text.trim() !== raw.trim()) save(text.trim() || '❓');
        else renderDocs();
      };
      // The "to answer" colour follows the text as it's typed, not only after saving.
      const mark = () => element.classList.toggle('ask', element.textContent.includes('❓'));
      mark();
      element.addEventListener('input', mark);
      element.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish(true); }
        if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      });
      element.addEventListener('blur', () => finish(true), {once: true});
    });
  };
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) { const h = document.createElement(`h${Math.min(4, heading[1].length + 2)}`); h.append(inline(heading[2])); box.append(h); continue; }
    if (line.startsWith('|')) {
      const table = document.createElement('table');
      let header = true;
      for (; i < lines.length && lines[i].trim().startsWith('|'); i++) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
        if (cells.every(cell => /^:?-{2,}:?$/.test(cell))) continue;
        const row = table.insertRow();
        const index = i, source = lines[i];
        cells.forEach((cell, c) => {
          const td = row.insertCell();
          td.append(inline(cell));
          if (cell.includes('❓')) td.classList.add('ask');
          if (!header && edit) editable(td, cell, text => edit(index, replaceCell(source, c, text)));
        });
        header = false;
      }
      i--;
      box.append(table);
      continue;
    }
    if (/^[-*]\s/.test(line)) {
      const ul = document.createElement('ul');
      for (; i < lines.length && /^\s*[-*]\s/.test(lines[i]); i++) {
        const li = document.createElement('li');
        const raw = lines[i].trim().slice(2), index = i, source = lines[i];
        li.append(inline(raw));
        if (raw.includes('❓')) li.classList.add('ask');
        if (edit) editable(li, raw, text => edit(index, replaceLine(source, text)));
        ul.append(li);
      }
      i--;
      box.append(ul);
      continue;
    }
    const p = document.createElement('p'); p.append(inline(line));
    if (line.includes('❓')) p.classList.add('ask');
    const index = i, source = lines[i];
    if (edit) editable(p, line, text => edit(index, replaceLine(source, text)));
    box.append(p);
  }
  return box;
}
function renderDocs() {
  for (const [doc, field] of [['profile', 'profile_markdown'], ['answers', 'answers_markdown']]) {
    $(`doc-${doc}`).replaceChildren(markdownView(shared.draft[field], (index, line) => {
      shared.draft[field] = withLine(shared.draft[field], index, line);
      draftChanged([field]);
      renderDocs();
    }));
  }
  $('draft-profile').value = shared.draft.profile_markdown;
  $('draft-answers').value = shared.draft.answers_markdown;
}

// Open questions: answer inline (added to the standard answers), or skip.
function renderQuestions() {
  const questions = shared.draft.open_questions;
  show($('open-questions'), questions.length > 0);
  $('open-count').textContent = `${questions.length} detail${questions.length === 1 ? '' : 's'} need${questions.length === 1 ? 's' : ''} your answer`;
  const box = $('open-list');
  const expanded = box.dataset.expanded === '1';
  const shown = expanded ? questions : questions.slice(0, 3);
  box.replaceChildren(...shown.map((question, i) => {
    const row = Object.assign(document.createElement('div'), {className: 'q-row'});
    const text = Object.assign(document.createElement('span'), {className: 'q-text', textContent: question});
    const answer = Object.assign(document.createElement('button'), {className: 'secondary small-btn', textContent: 'Answer'});
    const skip = Object.assign(document.createElement('button'), {className: 'link', textContent: 'Skip'});
    answer.addEventListener('click', () => {
      const input = Object.assign(document.createElement('input'), {placeholder: 'Your answer, then Enter'});
      input.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || !input.value.trim()) return;
        const heading = '# Answered during setup';
        if (!shared.draft.answers_markdown.includes(heading)) shared.draft.answers_markdown = `${shared.draft.answers_markdown.trim()}\n\n${heading}\n`;
        shared.draft.answers_markdown = `${shared.draft.answers_markdown.trimEnd()}\n- ${question} — ${input.value.trim()}\n`;
        shared.draft.open_questions.splice(shared.draft.open_questions.indexOf(question), 1);
        draftChanged(['answers_markdown', 'open_questions']);
        renderQuestions(); renderDocs();
      });
      row.replaceChildren(text, input);
      input.focus();
    });
    skip.addEventListener('click', () => { shared.draft.open_questions.splice(shared.draft.open_questions.indexOf(question), 1); draftChanged(['open_questions']); renderQuestions(); });
    row.append(text, answer, skip);
    return row;
  }));
  const more = $('open-more');
  show(more, questions.length > 3);
  more.textContent = expanded ? 'Show fewer' : `Show ${questions.length - 3} more`;
}

// The goals the AI proposed from the CV, as tiles; a click edits one (Enter or click away saves, Esc cancels). The
// correction goes into the drafted Profile (markdown-edit.js applyGoal), which is what's saved to Notion.
// A draft from before goals were proposed (a whole questionnaire then) shows the questionnaire's answers, read-only.
// Label/value rows as on the Strategy page (What you're targeting): a long value (a salary in three currencies, many
// languages) is clamped to two lines, with the whole text on hover and while editing.
const GOAL_TILES = [['seniority', 'user', 'Target level'], ['work_mode', 'building', 'Work mode'], ['minimum_salary', 'chart', 'Minimum salary'],
  ['languages', 'globe', 'Languages you work in']];
function renderGoals() {
  const goals = shared.draft.goals, old = shared.state.settings.questionnaire || {};
  $('draft-tiles').replaceChildren(...GOAL_TILES.flatMap(([key, glyph, label]) => {
    const term = el('dt', '', icon(glyph));
    term.append(label);
    const box = el('dd', 'goal');
    box.dataset.goal = key;
    const text = (goals ? goals[key] : old[key]) || '—';
    const value = el('span', 'goal-value', text);
    value.title = text;
    box.append(value);
    if (!goals) return [term, box];
    value.classList.add('editable');
    value.title = `${text}\n(click to correct)`;
    value.addEventListener('click', () => {
      if (value.isContentEditable) return;
      value.contentEditable = 'plaintext-only';
      value.focus();
      getSelection().selectAllChildren(value);
      let done = false;
      const finish = keep => {
        if (done) return;
        done = true;
        value.contentEditable = 'false';
        const text = value.textContent.trim();
        if (keep && text && text !== goals[key]) {
          goals[key] = text;
          shared.draft.profile_markdown = applyGoal(shared.draft.profile_markdown, key, text);
          draftChanged(['goals', 'profile_markdown']);
          renderDocs();
        }
        renderGoals();
      };
      value.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); finish(true); }
        if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      });
      value.addEventListener('blur', () => finish(true), {once: true});
    });
    return [term, box];
  }));
}

export function renderDraft() {
  show($('draft-loading'), false); show($('draft-error'), false); show($('draft-view'));
  $('draft-title').textContent = 'Review your strategy';
  show($('draft-subtitle'));
  $('draft-cost').textContent = `✦ AI draft · $${shared.draft.usd.toFixed(2)}`;
  show($('draft-cost'));
  $('draft-summary').textContent = shared.draft.summary;
  $('draft-summary').title = 'Click to show all';
  renderGoals();
  document.querySelectorAll('.review .chips').forEach(box => { box.dataset.expanded = ''; });
  renderLists();
  $('open-list').dataset.expanded = '';
  renderQuestions();
  renderDocs();
  $('draft-save').disabled = false;
}
// Same answers as the cached draft: show it again (no new Claude call). Changed answers or "Draft again": redraft.
// The saved draft is shown again (no new Claude call) unless it's out of date: answers or CV changed. During the
// first setup an out-of-date draft is redrafted; once setup is done, the user decides (Redraft), nothing automatic.
export async function toDraft() {
  const cached = await window.pilot.cachedDraft();
  const answersChanged = cached && (cached.answers?.anything_else || '') !== currentAnswers().anything_else;
  const stale = cached && (answersChanged || cached.cvChanged);
  if (!cached || (stale && !shared.state.settings.setupDone)) { buildDraft(); return; }
  shared.draft = cached.draft;
  goStep('draft');
  renderDraft();
  $('draft-stale-text').textContent = cached.cvChanged ? 'Your CV changed since this strategy was drafted.'
    : answersChanged ? 'Your note changed since this strategy was drafted.' : '';
  show($('draft-stale'), !!stale);
}
// Rebuild from CV (setup done before): say what drafting costs before it runs; nothing changes until the review.
export function showDraftCost() {
  show($('goals-cost'), !!shared.state.settings.setupDone);
}
async function saveDraft(parts = null) {
  for (const key of Object.keys(saveState)) delete saveState[key];
  document.querySelectorAll('#save-steps li').forEach(li => { li.className = ''; const count = li.querySelector('.count'); if (count) count.textContent = ''; });
  $('save-bar').style.width = '3%';
  $('save-title').textContent = 'Saving your strategy to Notion';
  message('save-message', '');
  show($('save-close'), false); show($('save-retry'), false);
  const replacing = !!shared.state.settings.setupDone;
  show(document.querySelector('[data-save-step="snapshot"]'), replacing);
  if (!replacing) saveState.snapshot = 1;  // nothing to keep on a first setup
  if (!$('save-dialog').open) $('save-dialog').showModal();
  const result = await window.pilot.saveStrategy({...shared.draft, profile_markdown: $('draft-profile').value, answers_markdown: $('draft-answers').value}, parts);
  if (!result.ok) {
    $('save-title').textContent = 'Not saved to Notion yet';
    message('save-message', osText(`${result.error} Your strategy is kept on this computer: try again.`), 'error');
    show($('save-close')); show($('save-retry'));
    return;
  }
  $('save-title').textContent = 'Saved to Notion ✓';
  $('save-bar').style.width = '100%';
  shared.state = await window.pilot.state();
  // A replaced strategy: back to the app; the first setup: on to the last step.
  setTimeout(() => {
    $('save-dialog').close();
    if (replacing) { show($('wizard'), false); show($('app')); loadJobs(); toastMessage('Strategy replaced ✓', 'The previous one is kept in Notion as “🗂 Previous strategy”.'); }
    else goStep('extras');
  }, 900);
}
async function openRebuildReview() {
  $('rebuild-groups').replaceChildren(el('p', 'message waiting', 'Comparing the draft with your current strategy…'));
  $('rebuild-total').textContent = '';
  $('replace-go').disabled = true;
  $('replace-dialog').showModal();
  const current = {...shared.draft, profile_markdown: $('draft-profile').value, answers_markdown: $('draft-answers').value};
  $('rebuild-draft-cost').textContent = shared.draft?.usd ? `This draft cost $${shared.draft.usd.toFixed(2)} (already spent). ` : '';
  const result = await window.pilot.rebuildImpact(current);
  if (!result.ok) { $('rebuild-groups').replaceChildren(el('p', 'message error', result.error)); return; }
  if (!result.groups.length) { $('rebuild-groups').replaceChildren(el('p', 'muted', 'This draft changes nothing in your current strategy.')); return; }
  const boxes = {};
  const update = () => {
    const picked = result.groups.filter(group => boxes[group.id].checked);
    $('replace-go').disabled = !picked.length;
    const usd = picked.map(group => Number((group.cost.match(/\$([\d.]+)/) || [])[1] || 0)).reduce((a, b) => a + b, 0);
    $('rebuild-total').textContent = picked.length ? `Applying ${picked.length} of ${result.groups.length}: ${usd ? `≈ $${usd.toFixed(2)} of AI re-scoring, spread over the next searches` : 'no AI cost'}.` : 'Nothing selected.';
  };
  $('rebuild-groups').replaceChildren(...result.groups.map(group => {
    const box = el('label', 'review-group');
    box.dataset.group = group.id;
    const check = Object.assign(document.createElement('input'), {type: 'checkbox', checked: true});
    boxes[group.id] = check;
    const text = el('span', 'review-text');
    const head = el('span', 'review-head');
    head.append(el('b', '', group.title), pill(group.cost, group.cost.startsWith('≈') ? 'warn' : 'neutral'));
    const list = el('ul', 'review-changes');
    list.append(...group.changes.slice(0, 8).map(change => el('li', '', change)), ...(group.changes.length > 8 ? [el('li', 'muted', `+ ${group.changes.length - 8} more`)] : []));
    text.append(head, list, el('span', 'muted small', group.impact));
    if (group.linked) text.append(el('span', 'small review-linked', 'Locations and remote rules changed: applied to the search and the Profile together, so the crawl and the fit score agree.'));
    box.append(check, text);
    check.addEventListener('change', () => {
      if (group.linked && boxes[group.linked]) boxes[group.linked].checked = check.checked;  // one atomic change
      update();
    });
    return box;
  }));
  update();
}
// Every dialog: a click on the dimmed backdrop closes it like Esc (a dialog that blocks Esc, e.g. while saving,
// blocks this too). Pressed and released outside, so selecting text in a field and letting go outside doesn't close it.
let pressedOutside = null;
const outside = (dialog, event) => {
  const box = dialog.getBoundingClientRect();
  return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
};
async function finishSetup() {
  shared.state.settings = await window.pilot.saveSettings({setupDone: true});
  show($('wizard'), false); show($('app'));
  loadJobs();
  // The first search starts now, on screen, so the list fills in while the user watches.
  window.pilot.firstSearch();
  showSearchStatus();
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  // ✎ on a card: a small input to add an entry (Enter adds, Esc closes).
  document.querySelectorAll('.review [data-edit]').forEach(button => button.addEventListener('click', () => {
    const card = button.closest('[data-list]');
    let input = card.querySelector('input.add');
    if (input) { input.remove(); return; }
    const name = card.dataset.list;
    input = Object.assign(document.createElement('input'), {className: 'add', placeholder: name === 'places' ? 'Add a place, then Enter' : 'Add, then Enter'});
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') input.remove();
      if (event.key !== 'Enter' || !input.value.trim()) return;
      listOf(name).push(LISTS[name][2](input.value));
      input.value = '';
      draftChanged(['search', 'preferences']);
      renderLists();
    });
    card.append(input);
    input.focus();
  }));
  $('draft-summary').addEventListener('click', () => $('draft-summary').classList.toggle('open'));
  document.querySelectorAll('[data-goto-step]').forEach(button => button.addEventListener('click', () => goStep(button.dataset.gotoStep)));
  document.querySelectorAll('.doc-edit').forEach(button => button.addEventListener('click', () => {
    const doc = button.dataset.doc, area = $(`draft-${doc}`), view = $(`doc-${doc}`);
    const editing = area.hidden;
    show(area, editing); show(view, !editing);
    button.textContent = editing ? 'Done editing' : 'Edit as text';
    if (!editing) renderDocs();
  }));
  $('open-more').addEventListener('click', () => { const box = $('open-list'); box.dataset.expanded = box.dataset.expanded === '1' ? '' : '1'; renderQuestions(); });
  $('draft-redraft').addEventListener('click', () => { show($('draft-stale'), false); buildDraft(); });
  for (const [id, field] of [['draft-profile', 'profile_markdown'], ['draft-answers', 'answers_markdown']]) {
    $(id).addEventListener('input', () => { shared.draft[field] = $(id).value; draftChanged([field]); });
  }
  $('cv-next').addEventListener('click', toDraft);
  $('draft-again').addEventListener('click', buildDraft);
  // First setup: save straight away. Setup done before (Rebuild from CV): review what changes, grouped by what each
  // change triggers (lib/strategy.js rebuildGroups), with the impact and AI cost; only the ticked groups are saved.
  $('draft-save').addEventListener('click', () => { if (shared.state.settings.setupDone) openRebuildReview(); else saveDraft(); });
  document.addEventListener('mousedown', event => {
    pressedOutside = event.target instanceof HTMLDialogElement && event.target.open && outside(event.target, event) ? event.target : null;
  });
  document.addEventListener('click', event => {
    const dialog = pressedOutside;
    pressedOutside = null;
    if (!dialog || event.target !== dialog || !outside(dialog, event)) return;
    if (dialog.dispatchEvent(new Event('cancel', {cancelable: true}))) dialog.close();
  });
  $('replace-cancel').addEventListener('click', () => $('replace-dialog').close());
  $('replace-go').addEventListener('click', event => {
    event.preventDefault();
    $('replace-dialog').close();
    saveDraft([...$('rebuild-groups').querySelectorAll('.review-group')].filter(row => row.querySelector('input').checked).map(row => row.dataset.group));
  });
  $('save-retry').addEventListener('click', saveDraft);
  $('save-close').addEventListener('click', () => $('save-dialog').close());
  $('save-dialog').addEventListener('cancel', event => { if (!$('save-close').hidden) return; event.preventDefault(); });  // no Esc while saving
  // "Set up" on the last step: finish the setup, open that Settings card, and offer the way back to the wizard.
  document.querySelectorAll('[data-goto-settings]').forEach(button => button.addEventListener('click', async () => {
    await finishSetup();
    openView('settings');
    show($('back-to-setup'));
    openSetting(button.dataset.gotoSettings);
  }));
  $('finish').addEventListener('click', finishSetup);
  $('back-to-setup-go').addEventListener('click', () => { show($('back-to-setup'), false); show($('app'), false); show($('wizard')); goStep('extras'); });
  $('back-to-setup-close').addEventListener('click', () => show($('back-to-setup'), false));
}
