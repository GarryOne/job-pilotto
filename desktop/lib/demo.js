// "Look around first": the app restarts on a fresh copy of the fictional demo data (demo/) and back to the user's
// own setup. A command-line flag carries the demo folder, so the restart works the same on Mac and Windows (no
// environment to pass on), and the actions that would reach outside answer "demo" instead of running.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FLAG = '--job-pilotto-demo';
export const PREFIX = 'job-pilotto-demo-';
export const TEXT = 'Demo mode: nothing is sent. Click "Set up my own" to use this with your own data.';

// Only a folder this module made (in the temp folder, named job-pilotto-demo-…): the flag can never point the
// demo's unencrypted store at the user's real data folder.
export function isDemoFolder(folder, tmp = os.tmpdir()) {
  if (!folder || !path.isAbsolute(folder)) return false;
  const resolved = path.resolve(folder);
  return path.dirname(resolved) === path.resolve(tmp) && path.basename(resolved).startsWith(PREFIX);
}

// The demo folder named on the command line (--job-pilotto-demo=<folder>), or null.
export function folderFrom(argv, tmp = os.tmpdir()) {
  const arg = argv.find(item => String(item).startsWith(`${FLAG}=`));
  const folder = arg ? arg.slice(FLAG.length + 1) : '';
  return isDemoFolder(folder, tmp) ? path.resolve(folder) : null;
}

// A fresh copy of demo/ in the temp folder; earlier copies go first. jobs.json stays in the app (read from there).
export function prepare(source, tmp = os.tmpdir()) {
  for (const name of fs.readdirSync(tmp)) {
    if (name.startsWith(PREFIX)) try { fs.rmSync(path.join(tmp, name), {recursive: true, force: true}); } catch { /* in use */ }
  }
  const folder = fs.mkdtempSync(path.join(tmp, PREFIX));
  // read + write, not copyFile: the packaged app's demo/ is inside app.asar.
  for (const name of fs.readdirSync(source)) {
    if (name !== 'jobs.json') fs.writeFileSync(path.join(folder, name), fs.readFileSync(path.join(source, name)));
  }
  return folder;
}

// The restart's arguments (app.relaunch({args})): this run's own, without a demo flag, plus the new one (into the
// demo) or none (back to the user's own data folder and setup).
export function restartArgs(argv, folder = null) {
  const args = argv.slice(1).filter(item => !String(item).startsWith(`${FLAG}=`));
  return folder ? [...args, `${FLAG}=${folder}`] : args;
}

// Window actions that would reach outside (Notion, Telegram, GitHub, Anthropic, Gmail, Claude, updates) or change
// this computer (keys, login item, recording): in demo mode they answer this instead of running.
export const BLOCKED = ['notionConnect', 'notionOAuth', 'saveSecret', 'startTrialCredit', 'checkAnthropic', 'cloudOff',
  'telegramCloudOn', 'telegramCloudOff', 'telegramConnect', 'googleConnect', 'licenseRemove', 'applyWithClaude', 'apply',
  'applyOne', 'sessionRestart', 'sessionResume', 'updateInstall', 'updateCheck', 'resetProfile', 'importProfile', 'importCv',
  'backupNow', 'refresh', 'firstSearch', 'checkMail', 'command', 'rescorePrevious', 'prepareKit', 'tailorCv', 'ivRecordStart',
  'ivTranscribe', 'ivSave', 'ivLink', 'ivReview', 'answerQuestion', 'cvApply', 'cvReview', 'saveStrategy', 'setStatus',
  'setAutomation', 'lookAround'];
export function blocked(name) {
  if (name === 'saveSecret') throw new Error(TEXT);  // its callers expect the keys back, or an error
  return {ok: false, error: TEXT, text: TEXT};
}
// ipcMain.handle, answering BLOCKED actions with blocked(name) (demo mode).
export const guard = handle => (name, listener) => handle(name, BLOCKED.includes(name) ? () => blocked(name) : listener);

// Python jobs in demo mode: only the ones that read the demo folder (the Strategy page, a job's posting).
const LOCAL = ['src.desktop strategy', 'src.desktop posting'];
export const pipelineAllowed = args => LOCAL.some(prefix => args.join(' ').startsWith(prefix));

// The Log box's confirmation step in demo mode: a fictional reading, nothing read. The default is the 30 Sep 2026
// case (a LinkedIn chat screenshot without a year, a call mentioned without a date: both asked, the kind to check);
// JOB_PILOTTO_DEMO_LEAD=existing shows a job already tracked (no company or "first contact" questions).
export function leadProposal(target = '', kind = process.env.JOB_PILOTTO_DEMO_LEAD) {
  const existing = kind === 'existing' || (target && target !== 'new');
  const kinds = ['Recruiter outreach', 'Applied', 'Confirmation received', 'Reply received', 'Interview scheduled', 'Rejected', 'Offer', 'Feedback received'];
  const fields = {
    kind: {value: 'Interview scheduled', state: 'check', options: kinds},
    channel: {value: existing ? '' : 'LinkedIn', state: existing ? 'ask' : 'check', guess: existing ? 'Other' : 'LinkedIn'},
    started: {value: '', state: 'ask', month_day: '09-21', years: [2026, 2025], question: 'Which year was "Sep 21"?'},
    interview: {value: '', state: 'ask', required: true, question: 'When is the call?', as_written: 'Friday at 3pm'},
    ...(existing ? {} : {company: {value: 'Example Robotics', state: 'check', required: false},
      agency: {value: 'Example Talent', state: 'ok', required: false}}),
  };
  return {ok: true, kind: 'Interview scheduled', new: !existing, stage: existing ? 'Applied' : '',
    label: existing ? 'Northwind AI — Platform Engineer' : 'Example Robotics — Senior SRE',
    item: {platform: 'LinkedIn', summary: 'Fictional demo reading'}, job: null, fields, stats: {}};
}
