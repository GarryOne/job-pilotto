// In-app terminals for Apply with Claude: each session runs `claude` in a pseudo-terminal (node-pty) inside the
// app instead of a Terminal window. The window shows them as a dock of cards and, on a click, a full terminal
// (xterm.js) where you can watch and type. Output is kept (the last OUTPUT_LIMIT characters), so opening a
// session later shows what it did.
//
// Status comes from the session itself, not guesses from the screen: Claude Code hooks (Stop = it finished its
// turn and waits for you, Notification = it asks for something, UserPromptSubmit = you answered) and the skill's
// tools/notify.sh ("Filling started", "Form filled", "Needs your input") report to the app's local server
// (/claude/session), which calls report() here.
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_LIMIT = 400_000;
const sessions = new Map();
let listener = () => {};
let loadPty = () => import('@lydell/node-pty').then(module => module.default || module);

// For tests: a fake pseudo-terminal.
export function usePty(loader) { loadPty = loader; }
// The app's window is told about every change: onChange(event, payload).
export function onChange(fn) { listener = fn; }

export async function available() {
  try { await loadPty(); return true; } catch { return false; }
}

const publicView = s => ({id: s.id, url: s.url, title: s.title, company: s.company, status: s.status, note: s.note,
  startedAt: s.startedAt, endedAt: s.endedAt || null, exitCode: s.exitCode ?? null, needsYouSince: s.needsYouSince || null,
  question: s.question || '', location: s.location || '', workMode: s.workMode || ''});
export const list = () => [...sessions.values()].map(publicView);
export const get = id => (sessions.has(id) ? publicView(sessions.get(id)) : null);
export const byUrl = url => list().filter(s => s.url === url).pop() || null;

// Start one session: file + args run in cwd with env, in a terminal of cols x rows.
export async function start({id, url, title = '', company = '', location = '', workMode = '', file, args = [], cwd, env, cols = 120, rows = 32}) {
  const pty = await loadPty();
  const term = pty.spawn(file, args, {name: 'xterm-256color', cols, rows, cwd, env: {...env, TERM: 'xterm-256color', COLORTERM: 'truecolor'}});
  const session = {id, url, title, company, location, workMode, term, output: '', status: 'running', note: 'Starting…', startedAt: new Date().toISOString()};
  sessions.set(id, session);
  term.onData(data => {
    session.output = (session.output + data).slice(-OUTPUT_LIMIT);
    listener('data', {id, data});
  });
  term.onExit(({exitCode}) => {
    session.exitCode = exitCode;
    session.endedAt = new Date().toISOString();
    if (session.status !== 'done') session.status = exitCode === 0 ? 'ended' : 'failed';
    if (session.status !== 'done') session.note = exitCode === 0 ? 'Session ended' : `Session stopped (exit ${exitCode})`;
    listener('update', publicView(session));
  });
  listener('update', publicView(session));
  return publicView(session);
}

export const output = id => sessions.get(id)?.output || '';
export function write(id, data) { sessions.get(id)?.term?.write(String(data)); }
export function resize(id, cols, rows) {
  const session = sessions.get(id);
  if (session && !session.endedAt && cols > 10 && rows > 3) session.term.resize(Math.floor(cols), Math.floor(rows));
}
export function stop(id) {
  const session = sessions.get(id);
  if (session && !session.endedAt) session.term.kill();
}
export function remove(id) {
  stop(id);
  sessions.delete(id);
  listener('update', {id, removed: true});
}
export const running = () => list().filter(s => !s.endedAt);

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
      if (text) return text.slice(-600);
    }
  } catch {}
  return '';
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
  return {session: publicView(session), needsYou: session.status === 'input' && before !== 'input'};
}

// Claude Code settings for a session: hooks that report to the app (curl, on macOS and in Git Bash on Windows).
export function hookSettings(id, port) {
  const post = event => ({type: 'command', command:
    `curl -s -m 3 -X POST -H 'X-Job-Pilotto: launcher' -H 'Content-Type: application/json' --data-binary @- ` +
    `'http://127.0.0.1:${port}/claude/session?id=${encodeURIComponent(id)}&event=${event}' >/dev/null 2>&1 || true`});
  return JSON.stringify({hooks: {
    Notification: [{hooks: [post('input')]}],
    Stop: [{hooks: [post('stop')]}],
    UserPromptSubmit: [{hooks: [post('prompt')]}],
  }});
}

export const _sessions = sessions;  // tests
export const label = session => [session.company, session.title].filter(Boolean).join(' · ') || path.basename(session.url || '');
