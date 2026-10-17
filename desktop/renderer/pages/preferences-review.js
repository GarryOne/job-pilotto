// Settings → Profile → Preferences, the "Review your preferences" card (owner, 17 Oct 2026): where the AI read a field's text differently from how it
// is stored (lib/preferences-parse.js), each field shows what you have now → what it proposes, with Accept / Keep mine and Accept all. Accepting only
// drafts the change into the tab's one save bar (the old wording is kept as an "Original wording" line, nothing is lost); nothing is written until Save.
// "Keep mine" is remembered per text in this window. Guarded by test/preferences-review-render.test.js.
import {el} from '../components.js';
import {FIELDS} from '../preferences-model.js';
import {reviewOf} from '../preferences-review-model.js';

const KEEP = 'preferences-review-kept';
const memory = new Set();   // also kept here for the window's life when localStorage is unavailable
const kept = () => { try { return new Set([...JSON.parse(localStorage.getItem(KEEP) || '[]'), ...memory]); } catch { return new Set(memory); } };
const remember = set => { set.forEach(each => memory.add(each)); try { localStorage.setItem(KEEP, JSON.stringify([...set].slice(-200))); } catch {} };
const ORDER = ['countries', 'cities', 'mode', 'relocation', 'languages', 'roles', 'employment', 'seniority'];

// The text the AI reads for each field: what the page holds (a ❓ row's hint is still what was typed), and the Home base for context.
export const textsOf = fields => Object.fromEntries([...ORDER, 'home'].map(key => [key, fields[key]?.value || fields[key]?.hint || '']));

// state: {key, parse, error, busy}; handled: keys accepted into the draft; apply(field, item, text); note(field, item, old) drafts the Original wording line.
export function reviewCard({fields, state, handled, apply, note, redraw}) {
  const skipped = kept();
  const rows = reviewOf(fields, state.parse, ORDER).filter(row => !handled.has(row.key) && !skipped.has(`${state.key}:${row.key}`));
  const box = el('section', 'answer-item qa-section pref-section pref-review');
  box.id = 'preferences-review-card';
  const head = el('div', 'qa-section-head pref-head'), words = el('div', 'pref-words');
  words.append(el('h4', '', 'Review your preferences'), el('span', 'muted small', state.busy ? 'Reading your Profile…'
    : state.error ? `Couldn't read it: ${state.error}` : 'Some of your answers read better as plain values. Nothing changes until you accept and save.'));
  head.append(words);
  box.append(head);
  if (!rows.length) return state.busy || state.error ? box : null;
  const accept = row => { const field = FIELDS.find(each => each.key === row.key), item = fields[row.key]; apply(field, item, row.proposed); if (row.old) note(field, item, row.old); handled.add(row.key); };
  const bar = el('div', 'pref-review-actions');
  const all = Object.assign(el('button', 'primary', 'Accept all'), {type: 'button', id: 'preferences-review-accept-all'});
  all.addEventListener('click', () => { rows.forEach(accept); redraw(); });
  const none = Object.assign(el('button', 'secondary', 'Keep mine'), {type: 'button', id: 'preferences-review-keep-all'});
  none.addEventListener('click', () => { rows.forEach(row => skipped.add(`${state.key}:${row.key}`)); remember(skipped); redraw(); });
  bar.append(all, none);
  const list = el('div', 'form-grid pref-body');
  for (const row of rows) {
    const field = FIELDS.find(each => each.key === row.key), line = el('div', 'pref-review-row span-all');
    line.dataset.field = row.key;
    const yes = Object.assign(el('button', 'primary small', 'Accept'), {type: 'button', ariaLabel: `Accept ${field.label}`});
    yes.addEventListener('click', () => { accept(row); redraw(); });
    const no = Object.assign(el('button', 'secondary small', 'Keep mine'), {type: 'button', ariaLabel: `Keep my ${field.label}`});
    no.addEventListener('click', () => { skipped.add(`${state.key}:${row.key}`); remember(skipped); redraw(); });
    const was = el('div', 'pref-review-was muted');
    was.append(el('b', '', 'Now: '), row.old || 'Not set');
    const will = el('div', 'pref-review-will');
    will.append(el('b', '', 'Proposed: '), row.proposed);
    const text = el('div', 'pref-review-text');
    text.append(el('h5', '', field.label), was, will);
    const buttons = el('div', 'pref-review-buttons');
    buttons.append(yes, no);
    line.append(text, buttons);
    list.append(line);
  }
  box.append(list, bar);
  return box;
}

