// Settings → Profile → Your details' fact sections over IPC (lib/profile-sections.js): read them (the first time, the facts move in once:
// lib/profile-move.js, copy and backup first), save them with Contact, and the owner's pick for "Which is right?". Registered by
// lib/contact-handlers.js. Guarded by test/details-facts.test.js and test/ipc.test.js.
import * as sections from './profile-sections.js';
import {move, resolve} from './profile-move.js';
import {claudeAi} from './question-ai.js';

// Demo mode: fictional lines (the screenshots), one "Which is right?".
const DEMO_FACTS = {eligibility: [{label: 'Nationality', value: 'British'}, {label: 'Work permit', value: 'Swiss B permit'}, {label: 'Need visa sponsorship?', value: 'No'}],
  availability: [{label: 'Salary expectation', value: 'CHF 140,000 a year'}], languages: [{label: 'Languages I can work in', value: 'English (native), German (B1), Spanish (native)'}]};
const DEMO_WHICH = [{home: 'availability', topic: 'notice period', choices: [{label: 'Notice period', value: '2 months', page: 'profile'}, {label: 'Notice period / earliest start', value: '3 months', page: 'answers'}]}];
const empty = () => Object.fromEntries(Object.keys(sections.SECTIONS).map(key => [key, []]));

export function registerDetailsFactsHandlers({ipcMain, storage, DEMO, connected, needsNotion, log}) {
  ipcMain.handle('detailsFacts', async () => {
    if (DEMO) return {ok: true, sections: storage.settings().demoFacts || DEMO_FACTS, conflicts: storage.settings().demoWhich ?? DEMO_WHICH};
    if (!connected()) return {ok: true, sections: empty(), conflicts: []};
    let error = '';
    if (!storage.settings().profileMovedAt) {
      try {
        const {moved, conflicts} = await move(storage, {ai: claudeAi(storage)});
        log('profile', 'facts moved into Your details', {moved, conflicts: conflicts.length});   // counts, never a value
      } catch (failed) { error = failed.message; log('profile', 'the facts move stopped', {error: failed.message}); }
    }
    try {
      return {ok: !error, error, sections: await sections.read(storage), conflicts: storage.settings().profileConflicts || []};
    } catch (failed) { return {ok: false, error: failed.message, sections: empty(), conflicts: []}; }
  });
  ipcMain.handle('saveDetailsFacts', async (_, facts) => {
    const gate = needsNotion('profile');
    if (gate) return gate;
    try {
      for (const key of Object.keys(sections.SECTIONS)) if (Array.isArray(facts?.[key])) await sections.save(storage, key, facts[key].map(line => ({label: String(line?.label || ''), value: String(line?.value || '')})));
      return {ok: true};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('resolveDetailsConflict', async (_, topic, pick) => {
    if (DEMO) return {ok: true};
    const gate = needsNotion('profile');
    return gate || resolve(storage, String(topic || ''), Number(pick)).catch(error => ({ok: false, error: error.message}));
  });
}
