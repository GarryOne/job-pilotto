// Values a "Which is right?" pick set aside (owner, 17 Oct 2026: a pick deleted the other value; "nothing is ever deleted"): kept in settings.setAside
// as {id, source: 'profile' | 'locations', title, label, value, restore, at} until the person undoes it (lib/set-aside-undo.js). `value` is the text the
// card shows; `restore` is what Undo needs to put it back. Guarded by test/set-aside.test.js.
import crypto from 'node:crypto';

export const list = storage => storage.settings().setAside || [];

// entries: [{source, title, label, value, restore}] -> the stored entries.
export function keep(storage, entries, now = new Date()) {
  const stored = entries.map(entry => ({...entry, id: crypto.randomBytes(6).toString('hex'), at: now.toISOString()}));
  if (stored.length) storage.saveSettings({setAside: [...list(storage), ...stored]});
  return stored;
}

export const find = (storage, id) => list(storage).find(each => each.id === id);
export const drop = (storage, id) => storage.saveSettings({setAside: list(storage).filter(each => each.id !== id)});
