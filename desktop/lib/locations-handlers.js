// Strategy → "Which locations are right?" over IPC (owner, 17 Oct 2026): the first read moves the Profile's places in once (lib/locations-store.js: copy and
// backup first), then the screen lists each conflict and the person's pick is written and read back. A pick changes the search, so it says
// "Your search changed". Registered by lib/search-tuning-handlers.js. Guarded by test/locations-handlers.test.js and test/ipc.test.js.
import {moveLocations, recheckQueue, resolveLocation} from './locations-store.js';
import {CHOICES, readSide} from './locations-move.js';
import {claudeAi} from './question-ai.js';
import {list} from './set-aside.js';
import {undo} from './set-aside-undo.js';

// Demo mode: fictional places (the screenshots), one conflict.
const DEMO_WHICH = [{kind: 'acceptable', strategy: ['Netherlands', 'Germany'], profile: ['Switzerland']}];
// A demo entry is read like a saved one: the crawl side as place names, never patterns (the screenshots of a real-shaped queue).
const asNames = entry => ({...entry, strategy: readSide(entry.strategyFragments || entry.strategy || []).shown});

export function registerLocationsHandlers({ipcMain, storage, DEMO, needsNotion, settingsDeps, log, ai: aiFor = claudeAi, backup}) {
  ipcMain.handle('locationsWhich', async () => {
    if (DEMO) return {ok: true, conflicts: (storage.settings().demoLocationsWhich ?? DEMO_WHICH).map(asNames), setAside: storage.settings().demoSetAside || []};
    if (needsNotion('profile')) return {ok: true, conflicts: [], setAside: []};
    let error = '';
    if (!storage.settings().locationsMovedAt) {
      const ai = aiFor(storage);
      try {
        const {moved, conflicts} = await moveLocations(storage, {ai, deps: settingsDeps?.(), ...(backup ? {backup} : {})});
        log('strategy', 'places moved into Locations', {moved, conflicts: conflicts.length});   // counts, never a place
        if (ai.client || ai.apiKey) storage.saveSettings({locationsMovedAt: new Date().toISOString()});   // judged once, not asked again
      } catch (failed) { error = failed.message; log('strategy', 'the Locations move stopped', {error: failed.message}); }
    }
    else {
      try {   // a queue saved by an older build is read again: place names, never patterns; the same places in other words leave it
        const before = (storage.settings().locationsConflicts || []).length;
        const after = (await recheckQueue(storage, {ai: aiFor(storage), deps: settingsDeps?.()})).length;
        if (after !== before) log('strategy', 'same places in other words moved', {moved: before - after, conflicts: after});
      } catch (failed) { error = failed.message; log('strategy', 'the Locations re-check stopped', {error: failed.message}); }
    }
    return {ok: !error, error, conflicts: storage.settings().locationsConflicts || [], setAside: list(storage).filter(each => each.source === 'locations')};
  });
  ipcMain.handle('resolveLocationConflict', async (_, kind, choice, places) => {
    if (DEMO) return {ok: true};
    if (!CHOICES.includes(choice)) return {ok: false, error: 'Unknown choice'};
    const result = await resolveLocation(storage, String(kind || ''), choice, {places: Array.isArray(places) ? places.map(String) : [], deps: settingsDeps?.()})
      .catch(error => ({ok: false, error: error.message}));
    if (result.ok) storage.saveSettings({searchChangedAt: new Date().toISOString()});
    return result;
  });
  // Undo of a value a pick set aside (Locations or a Profile fact: lib/set-aside.js).
  ipcMain.handle('undoSetAside', async (_, id) => {
    if (DEMO) return {ok: true};
    const result = await undo(storage, String(id || ''), {deps: settingsDeps?.()}).catch(error => ({ok: false, error: error.message}));
    if (result.ok) storage.saveSettings({searchChangedAt: new Date().toISOString()});
    return result;
  });
}
