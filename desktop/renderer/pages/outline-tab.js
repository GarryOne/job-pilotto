// Settings → Profile: a tab drawn from one or more texts' outlines (Application answers: the standard answers + Form knowledge; Preferences: the
// Profile), edited block by block on every store (IPC textOutline / textEdit, lib/text-outline-handlers.js). This module owns the loading, the pending
// changes per text and ONE sticky save bar (.save-bar, as "Unsaved changes to your details"); a tab only draws and calls change(name, change).
// A change to the same block replaces the earlier one. Guarded by test/profile-tabs-render.test.js.
import {el} from '../components.js';
import {message} from './core.js';

const keyOf = change => (change.op === 'append' || change.op === 'insert' ? `${change.op}:${change.key}` : `${change.op}:${change.id}:${change.index ?? ''}`);

// names: the texts the tab shows; draw(view, body) with view = {items: {name: outline}, store, link: {name: url}, change, undo, dirty, redraw}.
// onReset: called when the drafts end (Discard, a save, a load), so the tab drops its own draft state.
export function outlineTab(id, names, body, draw, {words = 'They are used for future applications once you save.', onReset = () => {}} = {}) {
  const pending = Object.fromEntries(names.map(name => [name, new Map()]));
  let state = {items: {}, store: '', link: {}};
  const size = () => names.reduce((sum, name) => sum + pending[name].size, 0);
  const bar = el('div', 'save-bar');
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Unsaved changes');
  const note = el('span', 'message');
  note.id = `outline-message-${id}`;
  const discard = Object.assign(el('button', 'secondary', 'Discard changes'), {type: 'button', id: `outline-discard-${id}`});
  const save = Object.assign(el('button', 'primary', 'Save changes'), {type: 'button', id: `outline-save-${id}`});
  const lead = el('div', 'save-bar-words');
  lead.append(el('b', '', 'Unsaved changes'), el('span', 'muted small', `Your changes are kept as a draft. ${words}`));
  bar.append(lead, note, discard, save);
  const follow = () => { bar.hidden = !size(); };

  const view = () => ({...state, redraw, dirty: size,
    change(name, change) { pending[name].set(keyOf(change), change); follow(); },
    undo(name, change) { pending[name].delete(keyOf(change)); follow(); }});
  function redraw() { body.replaceChildren(); draw(view(), body); body.append(bar); follow(); }
  const clear = () => { for (const name of names) pending[name].clear(); onReset(); };

  discard.addEventListener('click', () => { clear(); message(note.id, ''); redraw(); });
  save.addEventListener('click', async () => {
    save.disabled = true;
    const errors = [];
    for (const name of names.filter(each => pending[each].size)) {
      const answer = await window.pilot.textEdit(name, [...pending[name].values()]).catch(error => ({ok: false, error: error.message}));
      if (answer.items) { state.items[name] = answer.items; pending[name].clear(); }
      if (!answer.ok) errors.push(answer.error);
    }
    save.disabled = false;
    if (!errors.length) onReset();
    redraw();
    message(note.id, errors.length ? errors.join(' ') : 'Saved ✓ The next kits and form fills use it.', errors.length ? 'error' : 'ok');
    if (!errors.length) { bar.hidden = false; setTimeout(follow, 2500); }
  });

  return {
    async load() {
      body.replaceChildren(el('p', 'muted small', 'Loading…'));
      const results = await Promise.all(names.map(name => window.pilot.textOutline(name).catch(error => ({ok: false, error: error.message}))));
      const failed = results.find(result => !result.ok);
      if (failed) { body.replaceChildren(el('p', 'message error', `Couldn't read it: ${failed.error}`)); return; }
      state = {items: Object.fromEntries(names.map((name, i) => [name, results[i].items])), store: results[0].store,
        link: Object.fromEntries(names.map((name, i) => [name, results[i].link]))};
      clear();
      redraw();
    },
    redraw: () => redraw(),
    items: name => state.items[name] || [],
    dirty: () => size() > 0,
  };
}
