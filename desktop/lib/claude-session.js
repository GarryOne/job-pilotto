// Apply with Claude: one interactive Claude Code session per job, each in its own window (Terminal on the
// Mac, a console window on Windows), started in the app's pipeline folder, where the apply-to-job skill
// (.claude/skills), src/ and tools/ are. This is the app's launcher on both systems; tools/apply-batch-claude.sh
// stays for the owner's command line.
//
// Sessions run with --permission-mode bypassPermissions so they can work unattended in the window they open
// (no approval prompt on the first CV read or click). Acceptable only because the task is narrow (reach one
// form, fill it from a drafted kit), the skill's hard rule never clicks Submit, and the owner watches the window.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import crypto from 'node:crypto';

import * as pipeline from './pipeline.js';
import {PORT} from './server.js';
import * as terminals from './terminals.js';

// What a session gets from the app on top of the user's own environment: Notion, Telegram and the app's
// folders. Never ANTHROPIC_API_KEY: Claude Code runs on the user's own Claude login, not their API key.
const KEEP = /^(NOTION_[A-Z0-9_]+|JOB_PILOTTO_[A-Z0-9_]+|TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)$/;
const GAP_MS = 3000;  // between windows, so they don't all hit Chrome and Notion at once

// `python3` for the session's commands (the skill's), pointing at the app's own Python: a friend's computer
// may have none. A small sh script in <data>/bin, first on the session's PATH (Git Bash runs it on Windows).
export function pythonShim(storage, python = pipeline.python(), platform = process.platform) {
  if (!(platform === 'win32' ? path.win32 : path.posix).isAbsolute(python)) return null;  // development without a bundled Python: the system's python3
  const dir = storage.path('bin');
  fs.mkdirSync(dir, {recursive: true});
  const target = platform === 'win32' ? python.replaceAll('\\', '/') : python;
  fs.writeFileSync(path.join(dir, 'python3'), `#!/bin/sh\nexec '${target.replaceAll("'", "'\\''")}' "$@"\n`, {mode: 0o755});
  return dir;
}

export function sessionEnv(storage, parent = process.env, platform = process.platform, shim = pythonShim(storage)) {
  const app = pipeline.pipelineEnv(storage);
  const env = {...parent};
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_BASE_URL;  // Claude Code uses the user's own Claude login, never the free AI credit
  for (const [key, value] of Object.entries(app)) if (KEEP.test(key)) env[key] = value;
  env.JOB_PILOTTO_PYTHON = pipeline.python();
  env.JOB_PILOTTO_APPLY_RUN_DIR = storage.path('apply-runs');
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') || 'PATH';
  if (shim) env[pathKey] = [shim, env[pathKey]].filter(Boolean).join(platform === 'win32' ? ';' : ':');
  return env;
}

// The session's instructions: the skill does the work; this names the job, the files and the hand-off.
export function prompt(url, {auditFile}) {
  // This session opens the one form tab itself, with the mark that arms the Job Pilotto extension on it (claude-in-chrome
  // only sees tabs in its own group, so a tab the app opened is invisible to it): the extension fills most fields in
  // seconds; this session does the rest.
  const handoff = `Open the form tab yourself, once: tabs_context_mcp with createIfEmpty true, then navigate that tab to ${url}#jobpilotto-fill ` +
    '(keep the #jobpilotto-fill at the end, it arms the Job Pilotto extension on the tab, which then fills the form by itself). It is the ' +
    'only tab for this application: never open a second one. On each page, if <html> has data-jobpilotto-hook, read ' +
    'document.documentElement.dataset.jobpilottoFill every 3 s (in one JS call that waits, up to 90 s). state running: keep waiting. ' +
    'done: fill ONLY its todo (dropdowns that ignore scripted clicks, per the skill), then press Next when the form has another page. ' +
    'error: fill this page yourself. no-form: this page is not the form, so press Apply or Next in this same tab. account: sign in or create ' +
    'the account as the skill says; the extension does not type the password. After each navigation, wait for the new state. A tab opened from ' +
    'this one is the same session: use it, the extension follows it. If there is no data-jobpilotto-hook after 10 s, carry on without the extension. ' +
    'Never trigger the extension\'s fill yourself. Work only from the form in Chrome and the --context output: don\'t read this repo\'s tests, config or README, ' +
    'and report as needing my attention only a control on the form. ';
  return `Use the apply-to-job skill to apply to this job: ${url}. Don't ask me questions or discuss the skill file — just follow it: ` +
    'pull the drafted kit from Notion Applications for this job URL, get to the actual form in the open tab (claude-in-chrome) ' +
    `as the skill's "Reaching the form" section says, in that same tab: when the page is a job board's or only links out, follow its Apply / Apply now buttons to ` +
    "the employer's site, and create an account or sign in there if it asks (password from python3 -m src.ai.passwords, pasted from the clipboard, " +
    "never typed or shown). A confirmation email's code or link you read yourself with python3 -m src.sources.google verify --from <employer domain> " +
    `(Gmail, read-only). Whenever a CAPTCHA or a terms checkbox blocks you, run tools/notify.sh ${url} "Needs your input — see Terminal", ` +
    `tell me in one line what to do in Chrome, wait for my reply, then carry on. ${handoff}Fill it per the skill's rules (fast-path dropdowns via JS, ` +
    'leave genuine guesses/legal checkboxes empty), verify, and hand it over for me to review and Submit. If the --context call below finds no kit ' +
    `for this job, stop right there: fill nothing, run tools/notify.sh ${url} "No kit yet — press Prepare first", say so in one line and finish. ` +
    "Get everything in ONE call first — the kit, Profile, Application Answers and earlier runs' learnings for this job board: " +
    `python3 -m src.ai.apply_run --context ${url} (don't fetch those pages separately). For every dropdown, open it and pick with ` +
    "window.__jobPilottoClickOption('<exact option text>') — never type + Return, which picks partial matches (\"Male\" -> \"Female\"). " +
    "While filling, stamp phases inside JS calls you already make with window.__jobPilottoStep('<name>') (e.g. 'dropdowns', 'resume'). " +
    `Right before you fill the first field, run: tools/notify.sh ${url} "Filling started" and note the time from date -u +%FT%TZ. ` +
    'At hand-over, record the run instead of notifying yourself: in the form tab evaluate JSON.stringify({page_url: location.href, ' +
    'guard_active: !!window.__jobPilottoGuardActive, fields: window.__jobPilottoAuditVisibleFields(), steps: window.__jobPilottoSteps || []}), ' +
    `write that JSON to ${auditFile}, then run: python3 -m src.ai.apply_run --record ${url} --audit "${auditFile}" --started <that time> ` +
    '--learning "<one line on what you learned about this form, or empty if nothing new>" — it saves the run record, updates the Notion row and ' +
    `sends my "Form filled" or "Needs your input" notification. If the posting is gone ("Job not found", 404, or not on the company's board), ` +
    `don't stop to ask: run python3 -m src.ai.apply_batch --mark-closed ${url} (marks it Closed and notifies me), close the tab, and finish. ` +
    `If you stop on any other blocker before filling, just run tools/notify.sh ${url} "Needs your input — see Terminal". ` +
    "Job Pilotto marks the job applied when I submit, so you don't need to watch the tab. Everything you write is read by an applicant, not a " +
    "developer: never mention this repo, git status, tests, config files or code, and don't comment on anything that isn't the form. When you " +
    'stop or wait, end with one plain line about the form (for example "Review the form and click Submit"). Start now.';
}

const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

// The Mac: a Terminal window per session. Terminal doesn't pass the app's environment on, so the session's
// variables go through a private file (0600) that the new shell reads and deletes at once.
function openMac({claude, repo, env, shim, promptFile, dir, index}, run) {
  const envFile = path.join(dir, `session_${index}.env`);
  const lines = Object.entries(env).filter(([key]) => KEEP.test(key)).map(([key, value]) => `export ${key}=${shellQuote(value)}`);
  if (shim) lines.push(`export PATH=${shellQuote(shim)}:"$PATH"`);  // Terminal's own PATH, the app's python3 first
  fs.writeFileSync(envFile, lines.join('\n') + '\n', {mode: 0o600});
  const command = `cd ${shellQuote(repo)} && . ${shellQuote(envFile)} && rm -f ${shellQuote(envFile)} && ` +
    `${shellQuote(claude)} --chrome --permission-mode bypassPermissions "$(cat ${shellQuote(promptFile)})"`;
  const script = [
    'set wasRunning to application "Terminal" is running',
    'tell application "Terminal"',
    `  set cmd to ${JSON.stringify(command)}`,
    '  if wasRunning then',
    '    do script cmd',
    '  else',
    '    delay 0.5',
    '    do script cmd in window 1',  // a fresh launch opens its own empty window: use it
    '  end if',
    '  activate',
    'end tell'].join('\n');
  run('osascript', ['-e', script], {stdio: 'ignore', detached: true}).unref();
}

// Windows: `start` opens a new console window running claude, with the app's environment. The instructions
// stay in their file (a long argument through cmd.exe would need quoting cmd can't do reliably).
export function windowsCommand({claude, repo, promptFile}) {
  const ask = `Read the file ${promptFile.replaceAll('\\', '/')} and do exactly what it says.`;
  return `"start "Job Pilotto" /D "${repo}" "${claude}" --chrome --permission-mode bypassPermissions "${ask}""`;
}
function openWindows(options, run) {
  run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', windowsCommand(options)],
    {env: options.env, detached: true, stdio: 'ignore', windowsVerbatimArguments: true}).unref();
}

// Start one session per job URL. Resolves with the number started.
export async function launch(storage, urls, {claude, platform = process.platform, run = spawn, pipelineRun = pipeline.run,
  gap = GAP_MS, open = () => {}} = {}) {
  const repo = pipeline.REPO;
  const shim = pythonShim(storage, pipeline.python(), platform);
  const env = sessionEnv(storage, process.env, platform, shim);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilotto-'));
  // The prompt files are read when each window starts; removed well after that.
  setTimeout(() => fs.rmSync(dir, {recursive: true, force: true}), 10 * 60 * 1000).unref();
  let index = 0;
  for (const url of urls) {
    index += 1;
    if (index > 1 && gap) await new Promise(resolve => setTimeout(resolve, gap));
    // Stage → Applying right away, so a second run never queues the same job twice.
    await pipelineRun(storage, ['src.ai.apply_batch', '--mark-applying', url]).catch(() => {});
    open(url);  // the form tab, armed for the extension, before Claude starts
    const auditFile = path.join(dir, `audit_${index}.json`).replaceAll('\\', '/');
    const promptFile = path.join(dir, `prompt_${index}.txt`);
    fs.writeFileSync(promptFile, prompt(url, {auditFile}), {mode: 0o600});
    const options = {claude, repo, env, shim, promptFile, dir, index};
    if (platform === 'win32') openWindows(options, run);
    else openMac(options, run);
  }
  return index;
}

// In the app (the default when the terminal module loads): each session runs in a pseudo-terminal the app owns
// (terminals.js), shown as a card in the window's session dock and as a full terminal on a click. Hooks and
// tools/notify.sh report its state (JOB_PILOTTO_SESSION names it). Resolves with the sessions started.
export async function launchInApp(storage, urls, {claude, platform = process.platform, pipelineRun = pipeline.run,
  gap = GAP_MS, term = terminals, port = PORT, details = {}, open = () => {}} = {}) {
  const repo = pipeline.REPO;
  const shim = pythonShim(storage, pipeline.python(), platform);
  const env = sessionEnv(storage, process.env, platform, shim);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilotto-'));
  const started = [];
  for (const [index, url] of urls.entries()) {
    if (index && gap) await new Promise(resolve => setTimeout(resolve, gap));
    await pipelineRun(storage, ['src.ai.apply_batch', '--mark-applying', url]).catch(() => {});
    open(url);  // the form tab, armed for the extension, before Claude starts
    const id = crypto.randomUUID().slice(0, 8);
    const auditFile = path.join(dir, `audit_${id}.json`).replaceAll('\\', '/');
    const promptFile = path.join(dir, `prompt_${id}.txt`);
    const settingsFile = path.join(dir, `settings_${id}.json`);
    fs.writeFileSync(promptFile, prompt(url, {auditFile}), {mode: 0o600});
    fs.writeFileSync(settingsFile, term.hookSettings(id, port), {mode: 0o600});  // the hooks that report to the app
    const claudeId = crypto.randomUUID();  // the conversation: resume() can reopen it after the app was closed
    const flags = ['--chrome', '--permission-mode', 'bypassPermissions', '--settings', settingsFile, '--session-id', claudeId];
    // A one-line instruction naming the file: the terminal starts clean (not a screen of instructions, nor the
    // extension ticket), and cmd.exe on Windows needn't quote a long argument.
    const ask = `Read the file ${promptFile.replaceAll('\\', '/')} and do exactly what it says.`;
    const {file, args} = platform === 'win32'
      ? {file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', claude, ...flags, ask]}
      : {file: claude, args: [...flags, ask]};
    started.push(await term.start({id, url, claudeId, file, args, cwd: repo, env: {...env, JOB_PILOTTO_SESSION: id}, ...(details[url] || {})}));
  }
  // The prompt, settings and audit files: kept for the sessions' first minutes, then removed.
  setTimeout(() => fs.rmSync(dir, {recursive: true, force: true}), 3 * 3600 * 1000).unref();
  return started;
}

// Starts Claude again in the conversation of a session that isn't running (the app was closed, or it stopped).
// A session that was working gets a line to carry on; one that waited for you (a question, a filled form) is
// reopened as it was, waiting. The hooks are written again (the old settings file may be gone).
export async function resumeInApp(storage, id, {claude, platform = process.platform, term = terminals, port = PORT} = {}) {
  const old = term.list().find(entry => entry.id === id);
  if (!old) return {ok: false, error: 'This session is no longer in the list.'};
  if (!old.resumable) return {ok: false, error: old.live ? 'Claude is already running in this session.' : 'This session can\'t be resumed (it was started before sessions were kept).'};
  const repo = pipeline.REPO;
  const env = sessionEnv(storage, process.env, platform, pythonShim(storage, pipeline.python(), platform));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilotto-'));
  const settingsFile = path.join(dir, `settings_${id}.json`);
  fs.writeFileSync(settingsFile, term.hookSettings(id, port), {mode: 0o600});
  setTimeout(() => fs.rmSync(dir, {recursive: true, force: true}), 3 * 3600 * 1000).unref();
  const stopped = old.status === 'ended' || old.status === 'failed';
  const flags = ['--chrome', '--permission-mode', 'bypassPermissions', '--settings', settingsFile, '--resume', term.claudeIdOf(id)];
  const ask = stopped ? ['Job Pilotto was closed while you were working on this application. Carry on where you left off: check the form in Chrome (its tab may still be open), finish it, and stop before Submit.'] : [];
  const {file, args} = platform === 'win32'
    ? {file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', claude, ...flags, ...ask]}
    : {file: claude, args: [...flags, ...ask]};
  try {
    const resumed = await term.resume(id, {file, args, cwd: repo, env: {...env, JOB_PILOTTO_SESSION: id}});
    return {ok: true, session: resumed};
  } catch (error) { return {ok: false, error: error.message}; }
}
