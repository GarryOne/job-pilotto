// Settings → Profile → Preferences over IPC: the AI's clean reading of the Preferences fields (lib/preferences-parse.js), asked once per text.
// The window sends the fields' current text; nothing is written here (the window writes the accepted ones through the Profile's block edits).
// Demo mode: a fictional reading, no AI. Guarded by test/preferences-parse.test.js.
import {aiClient} from './confirmation.js';
import * as parseFields from './preferences-parse.js';

const DEMO_PARSE = {countries: ['CH'], cities: [{name: 'Zurich', country: 'CH'}], remote: 'yes', languages: [{name: 'English', level: 'C2'}, {name: 'German', level: 'B1'}, {name: 'Spanish', level: 'native'}],
  relocation: {answer: 'unknown', where: ''}, roles: [{title: 'Site Reliability Engineer', certainty: 'sure'}, {title: 'Platform Engineer', certainty: 'sure'}, {title: 'DevOps Engineer', certainty: 'sure'}],
  seniority: {min: 'senior', max: 'senior', open_ended: false}, employment: [], notes: [], unparsed: ['cities', 'languages']};

export function registerPreferencesHandlers({ipcMain, storage, DEMO, log}) {
  ipcMain.handle('preferencesParse', async (_, {fields = {}, again = false} = {}) => {
    if (DEMO) return {parse: DEMO_PARSE, key: 'demo', fresh: false};
    return parseFields.forFields(storage, {fields, client: aiClient(storage), again, log});
  });
}
