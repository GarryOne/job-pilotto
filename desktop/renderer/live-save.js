// Live cards (owner, 18 Oct 2026, pilot on Languages; sketch https://claude.ai/artifact/DzfXFnZfsAb8QdDXToypG4): a card's controls are its read view; each change
// saves on the spot, with no Edit and no save bar. One saver per card: quick changes go out as ONE write (a pick waits ~0.9 s, typing 1.5 s after the last key,
// leaving the field or Enter sends at once: owner decision 1), one write at a time. Each row says "Saving…", then "✓ Saved · Undo" for 8 s (owner decision 2:
// beside the field, plus ⌘Z for the last change); a failed write keeps the value on the row, tinted, with "Not saved · Retry", and counts on the page's save bar
// (save-bar.js), so the bar appears only then and leaving the page asks first. Styles: live-card.css. Rules: docs/rules/desktop-ui.md "Live cards".
// Guarded by test/live-save.test.js.
import {el} from './components.js';

export const WAIT_PICK = 900, WAIT_TEXT = 1500, KEEP_UNDO = 8000;
const inside = (row, node) => { for (let at = node; at; at = at.parentNode) if (at === row) return true; return false; };
// The change is typing when the focused box is a text box in that row: it waits for a pause.
const typing = row => { const node = globalThis.document?.activeElement; return Boolean(node && inside(row, node) && /^(TEXTAREA|INPUT)$/.test(node.tagName) && !/^(checkbox|radio|button)$/.test(node.type || '')); };
let lastSaved = null;   // {saver, row}: what ⌘Z undoes

// save(): writes the card's current values → {ok, error}. bar + id/tab/label: the page's save bar, where a failed write counts (and Retry all / Discard live).
// onSaved(rows): after a write that worked (e.g. the rows' "saved" copies move on).
export function liveSaver({save, bar = null, id = 'live', tab = '', label = '', onSaved = () => {}}) {
  let queued = new Map();       // row → undo(): back to what was saved (the first change since the last write keeps its undo)
  const failed = new Map();     // row → undo
  let timer = null, busy = false, again = false;
  function slotOf(row) {
    const slot = [...row.children].find(node => node.classList?.contains('live-status'));
    if (slot) return slot;
    const made = el('span', 'live-status');
    made.setAttribute('role', 'status');
    row.append(made);
    return made;
  }
  function paint(row, state, error = '') {
    const slot = slotOf(row);
    row.classList.toggle('live-failed', state === 'failed');
    clearTimeout(row.liveFade);
    slot.title = error;
    if (state === 'saving') slot.replaceChildren(el('span', 'is-wait', 'Saving…'));
    else if (state === 'undone') slot.replaceChildren(el('span', 'muted', 'Undone'));
    else if (state === 'saved') slot.replaceChildren(el('span', 'is-saved', '✓ Saved'), ' · ', action('Undo', () => undo(row)));
    else if (state === 'failed') slot.replaceChildren(el('span', 'is-failed', 'Not saved'), ' · ', action('Retry', retry));
    else slot.replaceChildren();
    if (state === 'saved' || state === 'undone') row.liveFade = setTimeout(() => paint(row, ''), KEEP_UNDO);
  }
  const action = (words, run) => { const node = Object.assign(el('button', 'link small', words), {type: 'button'}); node.addEventListener('click', event => { event.preventDefault?.(); run(); }); return node; };
  const source = bar?.register({id, tab, label, count: () => failed.size,
    async save() { retry(); await settle(); return failed.size ? {ok: false, error: 'Not saved yet'} : {ok: true}; },
    discard() { for (const [row, back] of failed) back?.(row); failed.clear(); source?.changed(); }});

  function schedule(wait) { clearTimeout(timer); timer = setTimeout(flush, wait); }
  // A row changed: undo() puts back what was saved and returns the row now on screen (a redrawn row may replace it).
  function changed(row, undo = null) {
    if (!queued.has(row)) queued.set(row, failed.get(row) ?? undo);
    failed.delete(row);
    const text = typing(row);
    if (!text) paint(row, 'saving');
    schedule(text ? WAIT_TEXT : WAIT_PICK);
  }
  async function flush() {
    clearTimeout(timer);
    if (busy) { again = true; return; }
    if (!queued.size) return;
    const batch = queued;
    queued = new Map();
    busy = true;
    for (const row of batch.keys()) paint(row, 'saving');
    const result = await Promise.resolve().then(save).catch(error => ({ok: false, error: error.message}));
    busy = false;
    for (const [row, back] of batch) {
      if (result?.ok) { paint(row, row.liveUndone ? 'undone' : 'saved'); row.liveUndo = row.liveUndone ? null : back; row.liveUndone = false; lastSaved = {saver, row}; }
      else { failed.set(row, back); paint(row, 'failed', result?.error || 'Not saved'); }
    }
    if (result?.ok) onSaved([...batch.keys()]);
    source?.changed();
    if (again || queued.size) { again = false; schedule(0); }
  }
  function retry() { for (const [row, back] of failed) { queued.set(row, back); paint(row, 'saving'); } failed.clear(); source?.changed(); return flush(); }
  // Undo: the row goes back to what it was before that change, and that is saved too.
  function undo(row) {
    const back = row.liveUndo;
    if (!back) return;
    row.liveUndo = null;
    const now = back(row) || row;
    now.liveUndone = true;
    queued.set(now, null);
    return flush();
  }
  const settle = async () => { while (busy || queued.size) { await flush(); await new Promise(done => setTimeout(done, 0)); } };
  const saver = {changed, flush, retry, undo, settle, failedCount: () => failed.size, pending: () => queued.size + (busy ? 1 : 0)};
  return saver;
}

// Leaving a field or Enter in a one-line box sends its change at once (owner decision 1); the card's box listens once.
export function liveCard(box, saver) {
  box.addEventListener('focusout', () => { if (saver.pending()) saver.flush(); });
  box.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target?.tagName === 'INPUT') { event.preventDefault?.(); saver.flush(); } });
}

// ⌘Z / Ctrl+Z outside a text box undoes the last saved change of any live card (inside a box the box's own undo works as usual).
export function undoKey(event) {
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey || String(event.key).toLowerCase() !== 'z') return false;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '') || event.target?.isContentEditable) return false;
  if (!lastSaved?.row?.liveUndo) return false;
  event.preventDefault?.();
  lastSaved.saver.undo(lastSaved.row);
  return true;
}
globalThis.document?.addEventListener?.('keydown', undoKey);
