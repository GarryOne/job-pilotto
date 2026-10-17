// The Profile's Possible CV gaps as one chip per gap with ✓ (I have this skill) and ✕ (not a gap) (owner, 17 Oct 2026, review M7), in Settings → Profile → Experience. A ✓ makes it a confirmed
// skill the CV and the fill read as one; a ✕ folds it away so it is not asked again; a chip you already answered can be put back. Lines of the part are the model's (gaps-model.js).
// Drawn from the shared parts (.tags, .tag, link buttons); no CSS of its own beyond question-review.css. Guarded by test/gaps-rows.test.js.
import {el} from './components.js';
import {readLines} from './gaps-model.js';

const button = (label, aria, onClick) => {
  const node = Object.assign(el('button', 'link', label), {type: 'button'});
  node.setAttribute('aria-label', aria);
  node.addEventListener('click', event => { event.preventDefault(); onClick(); });
  return node;
};

// part: {lines}; onPress(item, state): the person pressed ✓ (skill), ✕ (dropped) or put one back (check).
export function gapsBody(part, onPress, {tidied = null, onUndo = null} = {}) {
  const box = el('div', 'exp-part-body gap-rows'), read = readLines(part?.lines || []);
  const chip = item => {
    const row = el('span', `gap-chip is-${item.state}`);
    row.dataset.gap = item.item;
    row.append(el('span', 'gap-name', item.item));
    if (item.state === 'check') row.append(button('✓', `${item.item}: I have this skill`, () => onPress(item, 'skill')), button('✕', `${item.item}: not a gap`, () => onPress(item, 'dropped')));
    else row.append(el('span', 'muted small', item.state === 'skill' ? 'confirmed' : 'not a gap'), button('Undo', `${item.item}: put back`, () => onPress(item, 'check')));
    return row;
  };
  const by = state => read.items.filter(item => item.state === state);
  if (!read.items.length && !read.other.length) { box.append(el('p', 'muted', 'Not set yet.')); return box; }
  if (by('check').length) { const row = el('div', 'tags'); row.append(...by('check').map(chip)); box.append(el('p', 'muted small', `${by('check').length} to check: ✓ if you have the skill, ✕ if it is not a gap`), row); }
  else if (read.items.length) box.append(el('p', 'muted small', 'All checked ✓'));
  for (const state of ['skill', 'dropped']) {
    if (!by(state).length) continue;
    const fold = el('details', 'gap-fold');
    fold.append(el('summary', 'muted small', `${state === 'skill' ? 'Confirmed skills' : 'Not a gap'} (${by(state).length})`));
    const row = el('div', 'tags');
    row.append(...by(state).map(chip));
    fold.append(row);
    box.append(fold);
  }
  for (const other of read.other) box.append(el('p', 'muted small', other.text));
  if (tidied && onUndo) {   // the one-time split of the paragraph: said once, with its Undo (the pages before it are backed up)
    const line = el('p', 'muted small', `Split from one paragraph into ${tidied.changed === 1 ? 'one list' : `${tidied.changed} lists`}. `);
    line.append(button('Undo', 'Put the CV gaps paragraph back', onUndo));
    box.append(line);
  }
  return box;
}
