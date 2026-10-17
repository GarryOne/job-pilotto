// Settings → Profile → Your details' fact sections over IPC (lib/profile-sections.js): read them (the first time, the facts move in once:
// lib/profile-move.js, copy and backup first), save them with Contact, and the owner's pick for "Which is right?". Registered by
// lib/contact-handlers.js. Guarded by test/details-facts.test.js and test/ipc.test.js.
import * as sections from './profile-sections.js';
import {move, openConflicts, resolve} from './profile-move.js';
import {claudeAi} from './question-ai.js';
import * as kinds from './details-kinds.js';
import * as surveys from './survey-move.js';
import {list} from './set-aside.js';

// Demo mode: fictional lines (the screenshots), one "Which is right?".
const DEMO_FACTS = {eligibility: [{label: 'Nationality', value: 'British'}, {label: 'Switzerland', value: 'allowed, B permit', kind: 'per_country'}, {label: 'United States', value: 'needs visa', kind: 'per_country'}],
  availability: [{label: 'Target', value: '10000 CHF/month net', kind: 'salary', note: 'Treat as a target, not a posted field.'},
    {label: 'Salary expectation, UK', value: '120000 GBP/year', kind: 'salary', note: 'Minimum · Confirmed 26 Sep 2026.'},
    {label: 'Notice period', value: '1 month, ends at month-end', kind: 'duration', note: 'For a start-date field, give a concrete date.'}],
  languages: [{label: 'English', value: 'B2', kind: 'language'}, {label: 'Romanian', value: 'native', kind: 'language'}, {label: 'Russian', value: 'B1', kind: 'language'},
    {label: 'Languages I can work in (note)', value: 'No French, German or Italian.'}]};
const DEMO_WHICH = [{home: 'availability', topic: 'notice period', choices: [{label: 'Notice period', value: '2 months', page: 'profile'}, {label: 'Notice period / earliest start', value: '3 months', page: 'answers'}]}];
const empty = () => Object.fromEntries(Object.keys(sections.SECTIONS).map(key => [key, []]));

// ai/copy: a test passes its own.
export function registerDetailsFactsHandlers({ipcMain, storage, DEMO, connected, needsNotion, log, ai = () => claudeAi(storage), copy}) {
  const tidied = () => {
    const {detailsTidy: lines, surveyTidy: survey} = storage.settings(), live = [lines, survey].filter(done => done && !done.undone);
    return live.length ? {changed: live.reduce((sum, done) => sum + done.changed, 0), at: live.map(done => done.at).sort().at(-1)} : null;
  };
  ipcMain.handle('detailsFacts', async () => {
    if (DEMO) return {ok: true, sections: storage.settings().demoFacts || DEMO_FACTS, conflicts: storage.settings().demoWhich ?? DEMO_WHICH, setAside: storage.settings().demoSetAside || []};
    if (!connected()) return {ok: true, sections: empty(), conflicts: [], setAside: []};
    let error = '';
    if (!storage.settings().profileMovedAt) {
      try {
        const {moved, conflicts} = await move(storage, {ai: ai()});
        log('profile', 'facts moved into Your details', {moved, conflicts: conflicts.length});   // counts, never a value
      } catch (failed) { error = failed.message; log('profile', 'the facts move stopped', {error: failed.message}); }
    }
    try {
      const tidy = await kinds.tidy(storage, {ai: ai(), ...(copy ? {copy} : {})}).catch(failed => { error = error || failed.message; log('profile', 'the kinds tidy stopped', {error: failed.message}); return {changed: 0}; });
      const moved = await surveys.migrate(storage, {ai: ai(), ...(copy ? {copy} : {})}).catch(failed => { error = error || failed.message; log('profile', 'the survey move stopped', {error: failed.message}); return {changed: 0}; });
      if (moved.changed) log('profile', 'survey answers got their lists', {changed: moved.changed});   // a count, never a value
      if (tidy.changed) log('profile', 'Your details lines got their kinds', {changed: tidy.changed});   // a count, never a value
      const found = await sections.read(storage);
      return {ok: !error, error, sections: found, formats: await kinds.formatsOf(storage, found, ai()), tidied: tidied(), conflicts: await openConflicts(storage).catch(() => storage.settings().profileConflicts || []), setAside: list(storage).filter(each => each.source === 'profile')};
    } catch (failed) { return {ok: false, error: failed.message, sections: empty(), conflicts: [], setAside: []}; }
  });
  ipcMain.handle('undoDetailsTidy', async () => {
    if (DEMO) return {ok: true};
    const gate = needsNotion('profile');
    if (gate) return gate;
    const [lines, survey] = await Promise.all([kinds.undo(storage), surveys.undo(storage)].map(done => done.catch(failed => ({ok: false, error: failed.message}))));
    return lines.ok || survey.ok ? {ok: true} : lines;
  });
  ipcMain.handle('saveDetailsFacts', async (_, facts) => {
    const gate = needsNotion('profile');
    if (gate) return gate;
    try {
      for (const key of Object.keys(sections.SECTIONS)) if (Array.isArray(facts?.[key])) await sections.save(storage, key, facts[key].map(line => ({label: String(line?.label || ''), value: String(line?.value || ''), ...(kinds.COMPOSITE_KINDS.includes(line?.kind) ? {kind: line.kind} : {}), ...(String(line?.note || '').trim() ? {note: String(line.note)} : {})})));
      return {ok: true};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('resolveDetailsConflict', async (_, topic, pick) => {
    if (DEMO) return {ok: true};
    const gate = needsNotion('profile');
    return gate || resolve(storage, String(topic || ''), Number(pick)).catch(error => ({ok: false, error: error.message}));
  });
}
