// In-app terminals for Apply with Claude: each session runs `claude` in a pseudo-terminal (node-pty) inside the
// app instead of a Terminal window. The window shows them as a dock of cards and, on a click, a full terminal
// (xterm.js) where you can watch and type. Output is kept (the last OUTPUT_LIMIT characters), so opening a
// session later shows what it did.
//
// Status comes from the session itself, not guesses from the screen: Claude Code hooks (Stop = it finished its
// turn and waits for you, Notification = it asks for something, UserPromptSubmit = you answered) and the skill's
// tools/notify.sh ("Filling started", "Form filled", "Needs your input") report to the app's local server
// (/claude/session), which calls report() here.
//
// Sessions outlive the app: each one is saved to a file on this Mac as it changes (persist), and restore() brings
// them back at the next start, without their process (Claude ended with the app; Chrome's tabs did not). A
// session that was working comes back as stopped; one that waited for you (a question, a filled form) comes back
// as it was. resume() starts Claude again in the same conversation (claude --resume <claudeId>).
//
// The log shows the session's screen, not a replay of its bytes: Claude Code draws on the alternate screen and
// redraws it in place many times a second, so replaying its output at another size, or from a cut-off tail,
// leaves a blank or garbled screen. A headless terminal (the mirror) follows each session at its real size, and
// snapshot() serializes it: what a real terminal shows now. The saved record keeps that screen too.
import fs from 'node:fs';
import path from 'node:path';

let Headless = null;  // {Terminal, SerializeAddon}; without it the log falls back to the raw output
try {
  const [headless, serialize] = await Promise.all([import('@xterm/headless'), import('@xterm/addon-serialize')]);
  Headless = {Terminal: (headless.default || headless).Terminal, SerializeAddon: (serialize.default || serialize).SerializeAddon};
} catch { /* not installed */ }
function newMirror(cols, rows, initial = '') {
  if (!Headless) return null;
  const term = new Headless.Terminal({cols, rows, scrollback: 5000, allowProposedApi: true});
  const serializer = new Headless.SerializeAddon();
  term.loadAddon(serializer);
  if (initial) term.write(initial);
  return {term, serializer};
}
const screenOf = mirror => mirror.serializer.serialize({scrollback: 5000});
// A recorded output as a real terminal of cols x rows would show it (also for demo mode).
export async function snapshotOf(raw, cols = 120, rows = 32) {
  const mirror = newMirror(cols, rows);
  if (!mirror) return {data: raw, cols, rows};
  await new Promise(done => mirror.term.write(raw, done));
  const data = screenOf(mirror);
  mirror.term.dispose();
  return {data, cols, rows};
}

const OUTPUT_LIMIT = 400_000;
const SAVED_OUTPUT = 80_000;  // the tail of each session's output that is saved
const KEEP_DAYS = 14;
const sessions = new Map();
let saveFile = null, saveTimer = null, closing = false;
let listener = () => {};
let loadPty = () => import('@lydell/node-pty').then(module => module.default || module);

// For tests: a fake pseudo-terminal.
export function usePty(loader) { loadPty = loader; }
// The app's window is told about every change: onChange(event, payload).
export function onChange(fn) { listener = fn; }

export async function available() {
  try { await loadPty(); return true; } catch { return false; }
}

// A session is live while its process runs; a restored or ended one is not (but can be resumed with its claudeId).
const isLive = s => !!s.term && !s.endedAt;
const publicView = s => ({id: s.id, url: s.url, title: s.title, company: s.company, status: s.status, note: s.note,
  live: isLive(s), resumable: !!s.claudeId && !isLive(s),
  startedAt: s.startedAt, endedAt: s.endedAt || null, exitCode: s.exitCode ?? null, needsYouSince: s.needsYouSince || null,
  question: s.question || '', brief: briefly(s.question || s.note), location: s.location || '', workMode: s.workMode || ''});
export const list = () => [...sessions.values()].map(publicView);
export const get = id => (sessions.has(id) ? publicView(sessions.get(id)) : null);
export const claudeIdOf = id => sessions.get(id)?.claudeId || '';
export const byUrl = url => list().filter(s => s.url === url).pop() || null;

// Runs the process of a session: its output is kept and saved, its exit ends it (unless the app is closing).
function attach(session, {file, args = [], cwd, env, cols = 120, rows = 32}) {
  return loadPty().then(pty => {
    const term = pty.spawn(file, args, {name: 'xterm-256color', cols, rows, cwd, env: {...env, TERM: 'xterm-256color', COLORTERM: 'truecolor'}});
    session.term = term;
    Object.assign(session, {cols, rows});
    if (session.mirror) session.mirror.term.resize(cols, rows); else session.mirror = newMirror(cols, rows);
    term.onData(data => {
      session.output = (session.output + data).slice(-OUTPUT_LIMIT);
      session.mirror?.term.write(data);
      listener('data', {id: session.id, data});
      save();
    });
    term.onExit(({exitCode}) => {
      if (closing || session.term !== term) return;  // the app is quitting (state already saved), or it was resumed since
      session.exitCode = exitCode;
      session.endedAt = new Date().toISOString();
      if (session.status !== 'done') session.status = exitCode === 0 ? 'ended' : 'failed';
      if (session.status !== 'done') session.note = exitCode === 0 ? 'Session ended' : `Session stopped (exit ${exitCode})`;
      listener('update', publicView(session));
      save();
    });
  });
}

// Start one session: file + args run in cwd with env, in a terminal of cols x rows. claudeId is the Claude Code
// conversation it runs (claude --session-id), kept so the session can be resumed after the app was closed.
export async function start({id, url, title = '', company = '', location = '', workMode = '', claudeId = '', ...launch}) {
  const session = {id, url, title, company, location, workMode, claudeId, term: null, output: '', status: 'running', note: 'Starting…', startedAt: new Date().toISOString()};
  await attach(session, launch);
  sessions.set(id, session);
  listener('update', publicView(session));
  save();
  return publicView(session);
}

// Starts Claude again in the conversation of a session that isn't running (restored, ended or stopped). Its record
// stays: job, output (a line marks the restart), question. A stopped one goes back to working; one that waited
// for you stays as it was (it waits in the resumed conversation).
export async function resume(id, launch) {
  const session = sessions.get(id);
  if (!session) throw new Error('This session is no longer in the list.');
  if (isLive(session)) return publicView(session);
  await attach(session, launch);
  session.output = (session.output + '\r\n\x1b[2m— resumed —\x1b[0m\r\n').slice(-OUTPUT_LIMIT);
  session.endedAt = null;
  session.exitCode = null;
  if (session.status === 'ended' || session.status === 'failed') Object.assign(session, {status: 'running', note: 'Resuming…', needsYouSince: null});
  listener('update', publicView(session));
  save();
  return publicView(session);
}

// ---- Saving and restoring (sessions.json in the data folder; a cache of runtime state, never the only copy of
// anything the user owns: the run's result is in Notion and the filled form is in Chrome) ----
export function persist(file) { saveFile = file; }
const saved = s => ({id: s.id, url: s.url, title: s.title, company: s.company, location: s.location, workMode: s.workMode,
  claudeId: s.claudeId || '', status: s.status, note: s.note, question: s.question || '', answered: !!s.answered,
  startedAt: s.startedAt, endedAt: s.endedAt || null, exitCode: s.exitCode ?? null, needsYouSince: s.needsYouSince || null,
  output: s.output.length > SAVED_OUTPUT ? s.output.slice(-SAVED_OUTPUT).replace(/^[^\n]*\n/, '') : s.output,
  screen: s.mirror ? screenOf(s.mirror) : s.screen || '', cols: s.cols || 120, rows: s.rows || 32, savedAt: new Date().toISOString()});
export function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!saveFile) return;
  try {
    fs.mkdirSync(path.dirname(saveFile), {recursive: true});
    fs.writeFileSync(saveFile + '.tmp', JSON.stringify([...sessions.values()].map(saved)), {mode: 0o600});  // output can hold form answers
    fs.renameSync(saveFile + '.tmp', saveFile);
  } catch { /* not saved this time; the next change tries again */ }
}
function save() {
  if (!saveFile || saveTimer) return;
  saveTimer = setTimeout(saveNow, 1500);
  saveTimer.unref?.();
}
// At start: the saved sessions come back without a process. Working ones (their process died with the app) are
// shown as stopped; older than KEEP_DAYS are dropped. Returns how many came back.
export function restore(now = Date.now()) {
  if (!saveFile) return 0;
  let records = [];
  try { records = JSON.parse(fs.readFileSync(saveFile, 'utf8')); } catch { return 0; }
  for (const record of Array.isArray(records) ? records : []) {
    if (!record?.id || sessions.has(record.id) || now - Date.parse(record.startedAt) > KEEP_DAYS * 86400_000) continue;
    const {savedAt, screen, ...session} = record;
    // Its screen comes back as it was (older records have only the output's tail: the best that can be shown).
    session.mirror = newMirror(session.cols || 120, session.rows || 32, screen || session.output || '');
    if (session.status === 'running') Object.assign(session, {status: 'ended', note: 'Stopped when the app closed', endedAt: savedAt || new Date(now).toISOString()});
    sessions.set(session.id, {...session, term: null});
  }
  return sessions.size;
}
// The app is quitting: save what each session was doing, then end their processes without changing that.
export function shutdown() {
  saveNow();
  closing = true;
  for (const session of sessions.values()) if (isLive(session)) session.term.kill();
}

export const output = id => sessions.get(id)?.output || '';
// What the log shows when it opens: the session's screen and scrollback, at the size it was drawn for.
export async function snapshot(id) {
  const session = sessions.get(id);
  if (!session) return {data: '', cols: 120, rows: 32};
  const {cols = 120, rows = 32, mirror} = session;
  if (!mirror) return {data: session.output || '', cols, rows};
  await new Promise(done => mirror.term.write('', done));  // what's still being parsed
  return {data: screenOf(mirror), cols, rows};
}
export function write(id, data) { const session = sessions.get(id); if (session && isLive(session)) session.term.write(String(data)); }
export function resize(id, cols, rows) {
  const session = sessions.get(id);
  if (!session || !isLive(session) || cols <= 10 || rows <= 3) return;
  Object.assign(session, {cols: Math.floor(cols), rows: Math.floor(rows)});
  session.term.resize(session.cols, session.rows);
  session.mirror?.term.resize(session.cols, session.rows);
}
export function stop(id) {
  const session = sessions.get(id);
  if (session && isLive(session)) session.term.kill();
}
export function remove(id) {
  stop(id);
  sessions.get(id)?.mirror?.term.dispose();
  sessions.delete(id);
  listener('update', {id, removed: true});
  save();
}
export const running = () => list().filter(s => s.live);

// What a session reported: a hook event or a notify.sh message. Returns the new public view (null if unknown),
// and whether it now needs you (for the notification).
// Claude's last words in a session (its question when it waits for you): the last assistant text in the
// transcript Claude Code names in each hook call (JSON lines). '' when unreadable.
export function lastAssistantText(file, read = fs.readFileSync) {
  try {
    const lines = String(read(file, 'utf8')).trim().split('\n').slice(-200).reverse();
    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.type !== 'assistant') continue;
      const text = (entry.message?.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n').trim();
      if (text) return text.length > 3000 ? text.slice(-3000).replace(/^[^\n]*\n/, '') : text;  // whole lines only
    }
  } catch {}
  return '';
}

// A message in one short plain sentence (notifications, the dock): markdown removed, its question if it asks
// one (the last sentence ending in "?"), else its first sentence, cut at a word with "…".
export function briefly(text, limit = 160) {
  const plain = String(text || '').replace(/\*\*|__|`/g, '').replace(/^\s*(#+|[-*•]|\d+[.)])\s+/gm, '')
    .replace(/\s*\n+\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const sentences = plain.match(/[^.!?]+[.!?]+/g) || [plain];
  const pick = (sentences.filter(s => s.trim().endsWith('?')).pop() || sentences[0] || '').trim();
  if (pick.length <= limit) return pick;
  return pick.slice(0, limit).replace(/\s+\S*$/, '') + '…';
}

export function report(id, {event = '', message = '', transcript = ''} = {}) {
  const session = sessions.get(id);
  if (!session) return {session: null, needsYou: false};
  if (transcript && (event === 'stop' || event === 'input')) session.question = lastAssistantText(transcript) || session.question || '';
  if (event === 'prompt') session.question = '';
  const before = session.status;
  const text = String(message || '').trim();
  if (event === 'note' && /^Form filled/i.test(text)) Object.assign(session, {status: 'done', note: 'Form filled — review it in Chrome and Submit'});
  else if (event === 'note' && /Needs your input|No kit yet/i.test(text)) Object.assign(session, {status: 'input', note: text.replace(/\s*—\s*see Terminal$/, '')});
  else if (event === 'note' && text) Object.assign(session, {note: text});
  else if (event === 'input') Object.assign(session, {status: 'input', note: text || 'Claude needs your input'});
  else if (event === 'stop' && session.status !== 'done') Object.assign(session, {status: 'input', note: 'Waiting for your reply'});
  // The first prompt is the app's own instructions (Claude Code reports it like a reply): only later ones are yours.
  else if (event === 'prompt') Object.assign(session, {status: 'running', note: session.answered || before === 'input' ? 'Working on your reply…' : 'Working…', answered: session.answered || before === 'input'});
  if (session.status === 'input' && before !== 'input') session.needsYouSince = new Date().toISOString();
  if (session.status !== 'input') session.needsYouSince = null;
  listener('update', publicView(session));
  save();
  return {session: publicView(session), needsYou: session.status === 'input' && before !== 'input'};
}

// Claude Code settings for a session: hooks that report to the app (curl, on macOS and in Git Bash on Windows).
export function hookSettings(id, port) {
  // Double quotes and no redirects: the same command works in bash (Mac, Git Bash) and in cmd (Windows). Its tiny
  // {"ok":true} reply isn't shown for these hooks; with the app closed curl just fails quietly (-s) and Claude goes on.
  const post = event => ({type: 'command', command:
    `curl -s -m 3 -X POST -H "X-Job-Pilotto: launcher" -H "Content-Type: application/json" --data-binary @- ` +
    `"http://127.0.0.1:${port}/claude/session?id=${encodeURIComponent(id)}&event=${event}"`});
  return JSON.stringify({hooks: {
    Notification: [{hooks: [post('input')]}],
    Stop: [{hooks: [post('stop')]}],
    UserPromptSubmit: [{hooks: [post('prompt')]}],
  }});
}

export const _sessions = sessions;  // tests
export function _reset() { clearTimeout(saveTimer); saveTimer = null; saveFile = null; closing = false; sessions.clear(); }  // tests
export const label = session => [session.company, session.title].filter(Boolean).join(' · ') || path.basename(session.url || '');
