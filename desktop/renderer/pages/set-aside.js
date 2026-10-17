// "Set aside" under a Which-is-right card (owner, 17 Oct 2026: a pick never deletes the other value): each value a pick moved out of the way, with Undo
// (lib/set-aside.js). Shared by the Profile facts card and Strategy's Locations card. Guarded by test/set-aside-view.test.js.
import {el} from '../components.js';

// entries: the stored set-aside values; onChange: reload after an Undo; showError: where a failed Undo says why. -> the nodes to put in the card.
export function setAsideRows(entries, onChange, showError = () => {}) {
  if (!entries?.length) return [];
  const rows = entries.map(entry => {
    const row = el('div', 'chip-row');
    row.dataset.setAside = entry.id;
    const undo = Object.assign(el('button', 'link', 'Undo'), {type: 'button'});
    undo.setAttribute('aria-label', `Undo: put back ${entry.title} ${entry.value}`);
    undo.addEventListener('click', async () => {
      undo.disabled = true;
      const result = await window.pilot.undoSetAside(entry.id).catch(error => ({ok: false, error: error.message}));
      if (result.ok) onChange(); else { showError(result.error || ''); undo.disabled = false; }
    });
    row.append(el('span', 'muted small', `${entry.title}: ${entry.value}`), undo);
    return row;
  });
  return [el('b', '', 'Set aside'), el('p', 'muted small', 'You picked the other value. These are kept; Undo puts one back.'), ...rows];
}
