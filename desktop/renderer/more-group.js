// The "More · N" group, one component for the sidebar and the Actions page: a closed row that opens a list, its count, hidden at 0, its open/closed state remembered. Guarded by test/more-group.test.js.
export const moreTitle = count => `More · ${count}`;
export const isOpen = (storage, key) => { try { return storage.getItem(key) === 'open'; } catch { return false; } };
export const remember = (storage, key, open) => { try { storage.setItem(key, open ? 'open' : 'closed'); } catch { /* not remembered */ } };

// root: the group's box; head: its button; list: what opens; title: the text inside head. key: where its state is kept.
export function moreGroup({root, head, list, title, key, storage = window.localStorage}) {
  const apply = count => {
    const open = isOpen(storage, key);
    root.hidden = count === 0;
    title.textContent = moreTitle(count);
    head.setAttribute('aria-expanded', String(open));
    list.hidden = !open;
  };
  let count = 0;
  head.addEventListener('click', () => { remember(storage, key, !isOpen(storage, key)); apply(count); });
  return {draw: n => { count = n; apply(count); }, open: () => isOpen(storage, key)};
}
