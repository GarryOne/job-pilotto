// Undo for a value a pick set aside (lib/set-aside.js): a Profile fact is added back to its Your details section, a Locations list is written back to
// the search settings. The entry leaves the list only once the restore is written. Guarded by test/set-aside.test.js.
import {find, drop} from './set-aside.js';
import {restoreFact} from './profile-move.js';
import {restoreLocation} from './locations-store.js';

export async function undo(storage, id, {fetcher, deps = null} = {}) {
  const entry = find(storage, id);
  if (!entry) return {ok: false, error: 'That is no longer set aside'};
  const done = entry.source === 'locations' ? await restoreLocation(storage, entry, {deps}) : await restoreFact(storage, entry, {fetcher});
  if (done.ok) drop(storage, id);
  return done;
}
