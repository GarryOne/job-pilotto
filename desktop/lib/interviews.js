// Interviews page. Notion 🎤 Interviews is the database: every interview is a row there (transcript in the
// page, the job as its Application), listed, relinked and reviewed through src/ai/interviews.py. A transcript
// goes to Notion as soon as it's ready (meta.pageId); naming the speakers, the title and the job are edited in
// the app and written to that same row by Save. This Mac keeps the recordings (large files: <data
// folder>/recordings after saving) and the draft being edited (<data folder>/interviews/<id>/: meta.json, the
// audio, transcript.txt). Transcription is local and free (src/ai/transcribe.py).
import fs from 'node:fs';
import path from 'node:path';
import {log as appLog} from './log.js';
import * as pipeline from './pipeline.js';

export const AUDIO = ['webm', 'm4a', 'mp3', 'wav', 'ogg', 'oga', 'opus', 'mp4', 'mov', 'aac', 'flac', 'aiff', 'mkv'];
export const TEXT = ['txt', 'md', 'srt', 'vtt', 'text'];
const DRAFTS = 'interviews';

const folder = (storage, id) => storage.path(path.join(DRAFTS, cleanId(id)));
const metaFile = (storage, id) => path.join(folder(storage, id), 'meta.json');
function cleanId(id) { if (!/^[\w-]+$/.test(String(id))) throw new Error('Bad interview id'); return String(id); }

export function get(storage, id) {
  try { return JSON.parse(fs.readFileSync(metaFile(storage, id), 'utf8')); } catch { return null; }
}

function put(storage, meta) {
  fs.mkdirSync(folder(storage, meta.id), {recursive: true});
  fs.writeFileSync(metaFile(storage, meta.id), JSON.stringify(meta, null, 2) + '\n', {mode: 0o600});
  return meta;
}

export function update(storage, id, patch) {
  const meta = get(storage, id);
  if (!meta) throw new Error('Draft not found');
  return put(storage, {...meta, ...patch});
}

// Drafts, newest first. One left "transcribing" by a closed app shows as stopped, so it can be restarted.
export function drafts(storage) {
  let ids = [];
  try { ids = fs.readdirSync(storage.path(DRAFTS)); } catch {}
  return ids.map(id => get(storage, id)).filter(Boolean)
    .map(meta => (['transcribing', 'recording'].includes(meta.status) && !running.has(meta.id) && !recording.has(meta.id)
      ? {...meta, status: meta.status === 'recording' ? 'new' : 'stopped'} : meta))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function transcript(storage, id) {
  try { return fs.readFileSync(path.join(folder(storage, id), 'transcript.txt'), 'utf8'); } catch { return ''; }
}

export function saveDraft(storage, id, {title, text, jobUrl} = {}) {
  if (typeof text === 'string') fs.writeFileSync(path.join(folder(storage, id), 'transcript.txt'), text, {mode: 0o600});
  const patch = {};
  if (typeof title === 'string') patch.title = title.trim();
  if (jobUrl !== undefined) patch.jobUrl = jobUrl || null;
  return update(storage, id, patch);
}

const extension = name => (path.extname(name || '').slice(1) || '').toLowerCase();
function newId(now) { return `${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`; }

// A draft from a file on the Mac (a recording, or a transcript that only needs saving).
export function add(storage, source, now = new Date()) {
  const ext = extension(source);
  const kind = AUDIO.includes(ext) ? 'audio' : TEXT.includes(ext) ? 'text' : null;
  if (!kind) throw new Error(`Choose a recording (${AUDIO.join(', ')}) or a transcript (${TEXT.join(', ')})`);
  const id = newId(now);
  put(storage, {id, title: path.basename(source, path.extname(source)), createdAt: now.toISOString(), kind,
    file: `source.${ext}`, status: kind === 'audio' ? 'new' : 'ready'});
  fs.copyFileSync(source, path.join(folder(storage, id), `source.${ext}`));
  if (kind === 'text') saveDraft(storage, id, {text: fs.readFileSync(source, 'utf8')});
  return get(storage, id);
}

// A call recorded in the app, written chunk by chunk so a crash keeps what was said.
const recording = new Set();
export function startRecording(storage, {stereo = false} = {}, now = new Date()) {
  const id = newId(now);
  const title = `Interview ${now.toLocaleDateString('en-GB', {day: 'numeric', month: 'short'})} ${now.toTimeString().slice(0, 5)}`;
  put(storage, {id, title, createdAt: now.toISOString(), kind: 'audio', file: 'recording.webm', status: 'recording', stereo});
  fs.writeFileSync(path.join(folder(storage, id), 'recording.webm'), Buffer.alloc(0), {mode: 0o600});
  recording.add(id);
  return id;
}

export function appendRecording(storage, id, bytes) {
  if (!recording.has(id)) throw new Error('Not recording');
  fs.appendFileSync(path.join(folder(storage, id), get(storage, id).file), Buffer.from(bytes));
}

// extra: {micStartedAt} (ms), and for the call's audio {callFile, callStartedAt} (lib/calltap.js).
export function stopRecording(storage, id, seconds, extra = {}) {
  recording.delete(id);
  const allowed = Object.fromEntries(Object.entries(extra || {}).filter(([key]) => ['micStartedAt', 'callFile', 'callStartedAt'].includes(key)));
  return update(storage, id, {status: 'new', seconds: Math.round(seconds || 0), ...allowed});
}

// A draft is dropped after it's saved to Notion; its recording (if any) moves to recordings/.
// Recordings kept after saving are named "<title> <draft id> [<Notion page tag>]…", so deleting the Notion row
// can delete them too.
const pageTag = pageId => `[${String(pageId || '').replace(/-/g, '').slice(0, 8)}]`;
export function discard(storage, id, {keepRecording = false, pageId = null} = {}) {
  const meta = get(storage, id);
  if (keepRecording && meta?.kind === 'audio') {
    const tag = pageId ? ` ${pageTag(pageId)}` : '';
    const target = storage.path(path.join('recordings', `${(meta.title || id).replace(/[^\w ,.-]+/g, '_')} ${id.slice(0, 8)}${tag}.${extension(meta.file)}`));
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.renameSync(path.join(folder(storage, id), meta.file), target);
    const call = meta.callFile && path.join(folder(storage, id), meta.callFile);
    if (call && fs.existsSync(call)) fs.renameSync(call, target.replace(/\.[^.]+$/, ' (call audio, 16 kHz s16le).pcm'));
  }
  fs.rmSync(folder(storage, id), {recursive: true, force: true});
}

// "Speaker 1", "You", "Anna (recruiter)": the names before the colon of "[hh:mm:ss] Name: text" lines.
export function speakers(text) {
  const names = [];
  for (const match of String(text).matchAll(/^\[\d\d:\d\d:\d\d\] ([^:\n]{1,60}):/gm)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

export function renameSpeaker(text, from, to) {
  const clean = String(to).replace(/[:\n[\]]/g, ' ').trim();
  if (!clean || clean === from) return text;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text).replace(new RegExp(`^(\\[\\d\\d:\\d\\d:\\d\\d\\] )${escaped}:`, 'gm'), `$1${clean}:`);
}

// transcribe.py prints "progress <stage> <percent>" on stderr: one overall percent and a sentence.
const STAGES = {decode: [0, 3, 'Reading the recording'], transcribe: [3, 70, 'Writing down what was said'],
  speakers: [70, 100, 'Telling the speakers apart']};
export function progressOf(line) {
  const match = /^progress (\S+) (\d+)/.exec(line);
  if (!match) return null;
  const [stage, percent] = [match[1], Number(match[2])];
  if (stage.startsWith('download-')) {
    return {percent: null, text: `Downloading the speech models, only the first time (about 520 MB): ${stage.slice(9)} ${percent}%`};
  }
  const [from, to, text] = STAGES[stage] || [0, 100, stage];
  return {percent: Math.round(from + (to - from) * percent / 100), text};
}

const running = new Map();

// Transcribe a draft's recording on this Mac. onProgress({id, percent, text}); resolves with the draft.
export function transcribe(storage, id, {speakers: count = 0} = {}, onProgress = () => {}, run = pipeline.run) {
  const meta = get(storage, id);
  if (!meta || meta.kind !== 'audio') return Promise.reject(new Error('Nothing to transcribe'));
  if (running.has(id)) return running.get(id);
  update(storage, id, {status: 'transcribing', error: null});
  const out = path.join(folder(storage, id), 'transcript.txt');
  fs.rmSync(out, {force: true});
  const errors = [];
  const call = meta.callFile && path.join(folder(storage, id), meta.callFile);
  const withCall = call && fs.existsSync(call) && fs.statSync(call).size > 0
    ? ['--call', call, '--call-offset', String(Math.max(-60, Math.min(60, ((meta.callStartedAt || 0) - (meta.micStartedAt || meta.callStartedAt || 0)) / 1000)))] : [];
  const task = run(storage, ['src.ai.transcribe', path.join(folder(storage, id), meta.file), '--out', out,
    '--speakers', String(Number(count) || 0), ...withCall], line => {
    const step = progressOf(line);
    if (step) onProgress({id, ...step});
    else if (line.trim()) errors.push(line.trim());
  }).then(async ({code}) => {
    if (code === 0 && fs.existsSync(out)) {
      update(storage, id, {status: 'ready'});
      return (await toNotion(storage, id, run).catch(() => null)) || get(storage, id);
    }
    const reason = errors.filter(line => /Error|No module/.test(line)).pop() || errors.pop() || 'Transcription failed';
    return update(storage, id, {status: 'failed', error: /No module named '(sherpa_onnx|av|numpy)'/.test(reason)
      ? 'The transcription add-on is missing: pip install -r requirements-transcribe.txt' : reason});
  }).finally(() => running.delete(id));
  running.set(id, task);
  return task;
}

// ---- Notion (🎤 Interviews), through python -m src.ai.interviews ----
async function notionCall(storage, args, run) {
  const lines = [];
  const {stdout} = await run(storage, ['src.ai.interviews', ...args], line => lines.push(line));
  try { return JSON.parse(String(stdout).trim().split('\n').pop()); } catch {
    return {ok: false, error: lines.filter(Boolean).pop() || 'Notion could not be reached'};
  }
}

// The library (and its Insights row). A failure is written to app.log with its reason (never values): the page says
// so too, but the log is where a failure that only shows as "nothing on the page" is found.
export async function saved(storage, run = pipeline.run, log = appLog) {
  const result = await notionCall(storage, ['list'], run);
  if (!result?.ok) log('interviews', `library read failed: ${String(result?.error || 'no answer').slice(0, 300)}`);
  else if (result.insight_error) log('interviews', `insights unreadable (the library still shows): ${String(result.insight_error).slice(0, 300)}`);
  return result;
}

// The Insights card's Refresh (src/ai/interview_insights.py): Claude reads the reviewed interviews together, only when
// a review changed since the last update (else no AI call). Runs here, even with Always on: the page waits for it.
// One at a time: a second Refresh (another click, the window reloaded while one runs) joins the running one instead of
// paying for its own AI call (4 identical runs at 13:37 on 30 Sep 2026).
let refreshing = null;
export function refreshInsights(storage, run = pipeline.run) {
  refreshing ??= refreshOnce(storage, run).finally(() => { refreshing = null; });
  return refreshing;
}
async function refreshOnce(storage, run) {
  const lines = [];
  const {stdout} = await run(storage, ['src.ai.interview_insights', 'refresh'], line => lines.push(line));
  try { return JSON.parse(String(stdout).trim().split('\n').pop()); } catch {
    return {ok: false, error: lines.filter(Boolean).pop() || 'Could not refresh the insights'};
  }
}

// A "Practice next" tick box (src/ai/interview_insights.py set_step_done): saved in the insight row in Notion.
export async function insightStep(storage, text, done, run = pipeline.run) {
  const lines = [];
  const {stdout} = await run(storage, ['src.ai.interview_insights', 'step', '--text', String(text), '--done', done ? 'yes' : 'no'], line => lines.push(line));
  try { return JSON.parse(String(stdout).trim().split('\n').pop()); } catch {
    return {ok: false, error: lines.filter(Boolean).pop() || 'Could not save the tick'};
  }
}

export function link(storage, pageId, jobUrl, run = pipeline.run) {
  return notionCall(storage, ['link', pageId, ...(jobUrl ? ['--job', jobUrl] : [])], run);
}

// The draft's transcript -> its 🎤 Interviews row (created the first time, updated after that); no AI.
export async function toNotion(storage, id, run = pipeline.run) {
  const meta = get(storage, id);
  const text = transcript(storage, id);
  if (!meta || text.trim().length < 40) return null;
  const file = path.join(folder(storage, id), 'transcript.txt');
  const result = await notionCall(storage, ['save', file, '--title', meta.title || 'Interview',
    '--input', meta.kind === 'audio' ? 'Recording' : 'Transcript', ...(meta.jobUrl ? ['--job', meta.jobUrl] : []),
    ...(meta.pageId ? ['--page', meta.pageId] : [])], run);
  if (!result.ok) return null;
  return update(storage, id, {pageId: result.id || meta.pageId, pageUrl: result.url || meta.pageUrl || ''});
}

// Save: the edited transcript, title and job go to the draft's Notion row (created now if it has none yet),
// then the draft is dropped (its recording stays on this Mac, tagged with the row).
export async function save(storage, id, run = pipeline.run) {
  const meta = get(storage, id);
  const text = transcript(storage, id);
  if (!meta || text.trim().length < 40) return {ok: false, error: 'There is no transcript to save yet'};
  const file = path.join(folder(storage, id), 'transcript.txt');
  const result = await notionCall(storage, ['save', file, '--title', meta.title || 'Interview',
    '--input', meta.kind === 'audio' ? 'Recording' : 'Transcript', ...(meta.jobUrl ? ['--job', meta.jobUrl] : []),
    ...(meta.pageId ? ['--page', meta.pageId] : [])], run);
  if (result.ok) discard(storage, id, {keepRecording: true, pageId: result.id || meta.pageId});
  return result;
}

// Discard a draft: with its row already in Notion, the row goes to Notion's trash too (restorable 30 days).
export async function drop(storage, id, run = pipeline.run) {
  const meta = get(storage, id);
  if (meta?.pageId) {
    const result = await notionCall(storage, ['delete', meta.pageId], run);
    if (!result.ok) return result;
  }
  discard(storage, id);
  return {ok: true};
}

// Delete a saved interview: the Notion row goes to Notion's trash (restorable for 30 days) and the
// recordings kept on this Mac for it are deleted.
export async function remove(storage, pageId, run = pipeline.run) {
  const result = await notionCall(storage, ['delete', pageId], run);
  if (!result.ok) return result;
  const dir = storage.path('recordings');
  let removed = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.includes(pageTag(pageId))) { fs.rmSync(path.join(dir, name), {force: true}); removed += 1; }
    }
  } catch {}
  return {ok: true, removed};
}

// Claude's review of a saved row (question by question), written into that Notion page.
export async function review(storage, pageId, run = pipeline.run) {
  const lines = [];
  const {code} = await run(storage, [...pipeline.dailyArgs(storage, {mode: 'interview', interview: pageId})], line => lines.push(line));
  const done = lines.find(line => line.startsWith('Interview analysed'));
  if (code !== 0 || !done) {
    return {ok: false, error: lines.map(line => line.replace(/<[^>]+>/g, '')).filter(Boolean).pop() || 'The review failed'};
  }
  return {ok: true, summary: done.replace(/ https:\S+$/, ''), url: (done.match(/https:\/\/\S+$/) || [''])[0]};
}
