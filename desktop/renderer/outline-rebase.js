// Block changes made against an older read of a page, moved onto a fresh read just before they are written (owner, 18 Oct 2026: one Profile save bar
// saves several cards in one press; on this Mac a line's id is its line number, so an earlier save of another card can move every line under it). Each
// change's block is found again by its words: the same id when it still holds them (Notion's ids never move), else the block with those words nearest its
// old place. A block not found keeps its old id, so the store's own `was` check refuses it ("Some lines changed meanwhile") instead of editing the wrong
// line. No DOM: guarded by test/outline-rebase.test.js.

// items → [{id, words, at}] for every block and every table row (a row's words are its cells).
function blocksOf(items) {
  const out = [];
  for (const item of items || []) {
    out.push({id: String(item.id), words: String(item.text ?? ''), at: out.length});
    for (const row of item.rows || []) out.push({id: String(row.id), words: JSON.stringify(row.cells), at: out.length});
  }
  return out;
}

// The id in `now` of the block that was `id` in `before`.
function find(id, before, now) {
  const was = before.find(block => block.id === String(id));
  if (!was) return id;
  const same = now.find(block => block.id === String(id));
  if (same && same.words === was.words) return same.id;
  const matches = now.filter(block => block.words === was.words);
  if (!matches.length) return id;
  const where = was.at / Math.max(1, before.length);
  return matches.reduce((best, block) => (Math.abs(block.at / now.length - where) < Math.abs(best.at / now.length - where) ? block : best)).id;
}

// changes: [{op, id?, after?, …}] made against the outline `beforeItems` → the same changes against `nowItems`.
export function rebaseChanges(changes, beforeItems, nowItems) {
  const before = blocksOf(beforeItems), now = blocksOf(nowItems);
  return changes.map(change => {
    if (change.id !== undefined) return {...change, id: find(change.id, before, now)};
    if (change.after !== undefined) return {...change, after: find(change.after, before, now)};
    return change;
  });
}
