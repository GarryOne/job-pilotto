// Settings → Profile → Preferences, the "Review your preferences" card (owner, 17 Oct 2026): where the AI read a field's text differently from how it
// is stored (lib/preferences-parse.js), each field shows what you have now → what it proposes, with Accept / Keep mine and Accept all. Accepting only
// drafts the change into the tab's one save bar (the phrases the clean values lose are kept in ONE collapsed "Original wording" note under Other preferences); nothing is written until Save.
// "Keep mine" is remembered per text in this window. Each field is the shared choice row (page-parts.js choiceRow; owner, 18 Oct 2026: "Accept is too fat.
// Text is too much"): Now and Proposed side by side, a list field as chips with what is added or dropped marked. Guarded by test/preferences-review.test.js.
import {el} from '../components.js';
import {FIELDS, chipsOf} from '../preferences-model.js';
import {choiceRow, diffItems} from '../page-parts.js';
import {reviewOf} from '../preferences-review-model.js';

const KEEP = 'preferences-review-kept';
const memory = new Set();   // also kept here for the window's life when localStorage is unavailable
const kept = () => { try { return new Set([...JSON.parse(localStorage.getItem(KEEP) || '[]'), ...memory]); } catch { return new Set(memory); } };
const remember = set => { set.forEach(each => memory.add(each)); try { localStorage.setItem(KEEP, JSON.stringify([...set].slice(-200))); } catch {} };
const ORDER = ['countries', 'cities', 'mode', 'relocation', 'languages', 'roles', 'employment', 'seniority'];

// The text the AI reads for each field: what the page holds (a not-answered row's hint is still what was typed), and the Home base for context.
export const textsOf = fields => Object.fromEntries([...ORDER, 'home'].map(key => [key, fields[key]?.value || fields[key]?.hint || '']));

// state: {key, parse, error, busy}; handled: keys accepted into the draft; apply(field, item, text); note() re-drafts the one Original wording line from the accepted fields.
export function reviewCard({fields, state, handled, apply, note, redraw}) {
  const skipped = kept();
  // Only the fields the card draws (Strategy's Job preferences leaves work mode, seniority and languages to Goals and Your details).
  const rows = reviewOf(fields, state.parse, ORDER).filter(row => row.key in fields && !handled.has(row.key) && !skipped.has(`${state.key}:${row.key}`));
  const box = el('section', 'answer-item qa-section pref-section pref-review');
  box.id = 'preferences-review-card';
  const head = el('div', 'qa-section-head pref-head'), words = el('div', 'pref-words');
  words.append(el('h4', '', 'Review your preferences'), el('span', 'muted small', state.busy ? 'Reading your Profile…'
    : state.error ? `Couldn't read it: ${state.error}` : 'Some of your answers read better as plain values. Nothing changes until you accept and save.'));
  head.append(words);
  box.append(head);
  if (!rows.length) return state.busy || state.error ? box : null;
  const accept = row => { const field = FIELDS.find(each => each.key === row.key), item = fields[row.key]; apply(field, item, row.proposed); handled.add(row.key); note(); };
  const bar = el('div', 'pref-review-actions');
  // The card's one primary: Accept all; each row's Accept is outlined, Keep mine a link.
  const all = Object.assign(el('button', 'primary small-btn', 'Accept all'), {type: 'button', id: 'preferences-review-accept-all'});
  all.addEventListener('click', () => { rows.forEach(accept); redraw(); });
  const none = Object.assign(el('button', 'link small', 'Keep all mine'), {type: 'button', id: 'preferences-review-keep-all'});
  none.addEventListener('click', () => { rows.forEach(row => skipped.add(`${state.key}:${row.key}`)); remember(skipped); redraw(); });
  bar.append(all, none);
  const list = el('div', 'pref-body');
  for (const row of rows) {
    const field = FIELDS.find(each => each.key === row.key);
    // A list (roles, cities, countries) compared item by item; any other field as its two texts.
    const sides = field.widget === 'chips' ? diffItems(chipsOf(row.old), chipsOf(row.proposed)) : null;
    const line = choiceRow({key: row.key, title: field.label,
      sides: [{who: 'Now', tone: 'now', ...(sides && row.old ? {items: sides.now} : {text: row.old})}, {who: 'Proposed', tone: 'new', ...(sides ? {items: sides.next} : {text: row.proposed})}],
      actions: [{label: 'Accept', aria: `Accept ${field.label}`, run: () => { accept(row); redraw(); }},
        {label: 'Keep mine', link: true, aria: `Keep my ${field.label}`, run: () => { skipped.add(`${state.key}:${row.key}`); remember(skipped); redraw(); }}]});
    line.classList.add('pref-choice');
    line.dataset.field = row.key;
    list.append(line);
  }
  box.append(list, bar);
  return box;
}

