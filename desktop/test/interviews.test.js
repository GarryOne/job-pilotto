import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as interviews from '../lib/interviews.js';
import {createStorage} from '../lib/storage.js';

const plain = {encrypt: v => v, decrypt: v => v};
const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-iv-')), plain);
const TEXT = '[00:00:00] Speaker 1: How do you run upgrades?\n[00:00:04] You: One node pool at a time.\n[00:00:09] Speaker 1: Why?';

test('speakers are listed and renamed on every line of theirs only', () => {
  assert.deepEqual(interviews.speakers(TEXT), ['Speaker 1', 'You']);
  const renamed = interviews.renameSpeaker(TEXT, 'Speaker 1', 'Hiring manager: [x]');
  assert.deepEqual(interviews.speakers(renamed), ['Hiring manager   x', 'You']);
  assert.equal(interviews.renameSpeaker(TEXT, 'Speaker 1', ' '), TEXT);
  assert.match(interviews.renameSpeaker('[00:00:01] Speaker 1: I was Speaker 1: really', 'Speaker 1', 'Ana'), /Ana: I was Speaker 1: really/);
});

test('transcribe.py progress lines become one percent and a sentence', () => {
  assert.deepEqual(interviews.progressOf('progress transcribe 50'), {percent: 37, text: 'Writing down what was said'});
  assert.equal(interviews.progressOf('progress speakers 100').percent, 100);
  assert.deepEqual(interviews.progressOf('progress download-asr 40'), {percent: 40, setup: true, text: 'Downloading the speech models, only the first time (about 520 MB): asr'});
  assert.equal(interviews.progressOf('progress extract-asr 0').setup, true);
  assert.equal(interviews.progressOf('progress transcribe 10').setup, undefined);
  assert.match(interviews.progressOf('progress addon 0').text, /transcription add-on/);
  assert.equal(interviews.progressOf('Warning: something'), null);
});

test('a recording is written chunk by chunk, transcribed with progress, saved to Notion, then leaves the Mac drafts', async () => {
  const storage = tempStorage();
  const id = interviews.startRecording(storage, {stereo: true}, new Date('2026-09-28T10:00:00Z'));
  interviews.appendRecording(storage, id, new Uint8Array([1, 2]));
  interviews.appendRecording(storage, id, new Uint8Array([3]));
  fs.writeFileSync(storage.path(`interviews/${id}/call.pcm`), Buffer.alloc(8));
  interviews.stopRecording(storage, id, 61.4, {micStartedAt: 1000, callStartedAt: 1250, callFile: 'call.pcm', stereo: 'no'});
  assert.throws(() => interviews.appendRecording(storage, id, new Uint8Array([4])), /Not recording/);
  const draft = interviews.get(storage, id);
  assert.deepEqual([draft.status, draft.seconds, draft.stereo], ['new', 61, true]);
  assert.deepEqual([...fs.readFileSync(storage.path(`interviews/${id}/recording.webm`))], [1, 2, 3]);

  const calls = [], steps = [];
  const run = async (_storage, args, onLine) => {
    calls.push(args);
    if (args[0] === 'src.ai.transcribe') {
      onLine('progress transcribe 100');
      fs.writeFileSync(args[args.indexOf('--out') + 1], TEXT);
      return {code: 0, stdout: ''};
    }
    return {code: 0, stdout: 'x\n{"ok": true, "id": "page-1", "url": "https://notion.test/page-1"}\n'};
  };
  const done = await interviews.transcribe(storage, id, {speakers: 2}, step => steps.push(step), run);
  assert.equal(done.status, 'ready');
  assert.deepEqual(calls[0].slice(-8), ['--out', storage.path(`interviews/${id}/transcript.txt`), '--speakers', '2',
    '--call', storage.path(`interviews/${id}/call.pcm`), '--call-offset', '0.25']);
  assert.equal(interviews.get(storage, id).stereo, true);  // only known fields are taken from the window
  assert.equal(steps[0].percent, 70);
  // The transcript went to Notion as soon as it was ready: the draft knows its row.
  assert.deepEqual(calls[1].slice(0, 2), ['src.ai.interviews', 'save']);
  assert.deepEqual([done.pageId, done.pageUrl], ['page-1', 'https://notion.test/page-1']);

  interviews.saveDraft(storage, id, {title: 'Grafana, round 1', jobUrl: 'https://jobs.test/1', text: interviews.renameSpeaker(TEXT, 'Speaker 1', 'Manager')});
  const saved = await interviews.save(storage, id, run);
  assert.deepEqual(saved, {ok: true, id: 'page-1', url: 'https://notion.test/page-1'});
  // Save wrote the edits to that same row (--page), not a second one.
  assert.deepEqual(calls[2].slice(3), ['--title', 'Grafana, round 1', '--input', 'Recording', '--job', 'https://jobs.test/1', '--page', 'page-1']);
  assert.deepEqual(interviews.drafts(storage), []);
  const kept = fs.readdirSync(storage.path('recordings'));
  assert.equal(kept.length, 2);
  assert.ok(kept.some(name => /^Grafana, round 1 \d{8} \[page1\]\.webm$/.test(name)));
  assert.ok(kept.some(name => name.endsWith('(call audio, 16 kHz s16le).pcm')));
});

test('deleting a draft whose transcript is already in Notion trashes that row too', async () => {
  const storage = tempStorage();
  const source = path.join(storage.dir, 'call.txt');
  fs.writeFileSync(source, TEXT);
  const draft = interviews.add(storage, source);
  const calls = [];
  const run = async (_s, args) => { calls.push(args); return {code: 0, stdout: '{"ok": true, "id": "page-9", "url": "https://notion.test/9"}'}; };
  assert.equal((await interviews.toNotion(storage, draft.id, run)).pageId, 'page-9');
  assert.deepEqual(await interviews.drop(storage, draft.id, run), {ok: true});
  assert.deepEqual(calls[1], ['src.ai.interviews', 'delete', 'page-9']);
  assert.deepEqual(interviews.drafts(storage), []);
});

test('deleting a saved interview trashes the Notion row and its recordings on the Mac', async () => {
  const storage = tempStorage();
  fs.mkdirSync(storage.path('recordings'));
  fs.writeFileSync(storage.path('recordings/Call 20260928 [abcd1234].webm'), 'x');
  fs.writeFileSync(storage.path('recordings/Other 20260928 [ffff0000].webm'), 'x');
  let args;
  const result = await interviews.remove(storage, 'abcd1234-5678', async (_s, a) => { args = a; return {code: 0, stdout: '{"ok": true}'}; });
  assert.deepEqual(args, ['src.ai.interviews', 'delete', 'abcd1234-5678']);
  assert.deepEqual(result, {ok: true, removed: 1});
  assert.deepEqual(fs.readdirSync(storage.path('recordings')), ['Other 20260928 [ffff0000].webm']);
});

test('a failed Notion save keeps the draft; a missing add-on says how to install it', async () => {
  const storage = tempStorage();
  const source = path.join(storage.dir, 'call.txt');
  fs.writeFileSync(source, TEXT);
  const draft = interviews.add(storage, source);
  assert.equal(draft.status, 'ready');
  const failed = await interviews.save(storage, draft.id, async () => ({code: 1, stdout: '{"ok": false, "error": "Connect Notion first"}'}));
  assert.equal(failed.error, 'Connect Notion first');
  assert.equal(interviews.drafts(storage).length, 1);
  assert.throws(() => interviews.add(storage, path.join(storage.dir, 'cv.pdf')), /Choose a recording/);

  const audio = path.join(storage.dir, 'call.m4a');
  fs.writeFileSync(audio, 'x');
  const recording = interviews.add(storage, audio);
  const result = await interviews.transcribe(storage, recording.id, {}, () => {},
    async (_s, _a, onLine) => { onLine("ModuleNotFoundError: No module named 'sherpa_onnx'"); return {code: 1}; });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /add-on is missing/);
});

test('a review runs the interview mode on the saved Notion row and returns its summary', async () => {
  const storage = tempStorage();
  let args;
  const result = await interviews.review(storage, 'page-1', async (_s, a, onLine) => {
    args = a;
    onLine('Interview analysed (Grafana Labs, Technical 1, 8 questions, $0.041) https://notion.test/page-1');
    return {code: 0};
  });
  assert.deepEqual(args.slice(0, 4), ['src', 'daily', '--mode', 'interview']);
  assert.deepEqual(args.slice(args.indexOf('--interview'), args.indexOf('--interview') + 2), ['--interview', 'page-1']);
  assert.deepEqual(result, {ok: true, summary: 'Interview analysed (Grafana Labs, Technical 1, 8 questions, $0.041)', url: 'https://notion.test/page-1'});
});

test('the library row links to its job: clickable Job cell, Open job/interview in Notion, Link a job when none', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/interviews.js', import.meta.url), 'utf8');
  assert.match(source, /openView\('jobs'\); showJobsIn\(/);
  assert.match(source, /Open interview in Notion/);
  assert.match(source, /Open job in Notion/);
  assert.match(source, /'Link a job'/);
  assert.match(source, /Link a job…/);
});

test('the one-time setup runs once at a time, reports as the setup banner, and a transcription waits for it', async () => {
  const calls = [], shown = [];
  let finish;
  const run = (storage, args, onLine) => {
    calls.push(args);
    if (args.includes('--download-only')) {
      onLine('progress download-asr 50');
      return new Promise(resolve => { finish = () => resolve({code: 0}); });
    }
    return Promise.resolve({code: 1, stdout: ''});
  };
  const first = interviews.prefetch({}, step => shown.push(step), run);
  assert.equal(interviews.prefetch({}, () => {}, run), first);
  assert.equal(calls.length, 1);
  assert.deepEqual(shown[0], {id: 'setup', percent: 50, setup: true, text: 'Downloading the speech models, only the first time (about 520 MB): asr'});
  finish();
  assert.deepEqual(await first, {ok: true});
  assert.equal(interviews.prefetch({}, () => {}, () => Promise.resolve({code: 1})) === first, false);
});
