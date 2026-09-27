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
  assert.equal(interviews.progressOf('progress download-asr 0').percent, null);
  assert.equal(interviews.progressOf('Warning: something'), null);
});

test('a recording is written chunk by chunk, transcribed with progress, saved to Notion, then leaves the Mac drafts', async () => {
  const storage = tempStorage();
  const id = interviews.startRecording(storage, {stereo: true}, new Date('2026-09-28T10:00:00Z'));
  interviews.appendRecording(storage, id, new Uint8Array([1, 2]));
  interviews.appendRecording(storage, id, new Uint8Array([3]));
  interviews.stopRecording(storage, id, 61.4);
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
  assert.deepEqual(calls[0].slice(-4), ['--out', storage.path(`interviews/${id}/transcript.txt`), '--speakers', '2']);
  assert.equal(steps[0].percent, 70);

  interviews.saveDraft(storage, id, {title: 'Grafana, round 1', jobUrl: 'https://jobs.test/1', text: interviews.renameSpeaker(TEXT, 'Speaker 1', 'Manager')});
  const saved = await interviews.save(storage, id, run);
  assert.deepEqual(saved, {ok: true, id: 'page-1', url: 'https://notion.test/page-1'});
  assert.deepEqual(calls[1].slice(0, 2), ['src.ai.interviews', 'save']);
  assert.deepEqual(calls[1].slice(3), ['--title', 'Grafana, round 1', '--input', 'Recording', '--job', 'https://jobs.test/1']);
  assert.deepEqual(interviews.drafts(storage), []);
  const kept = fs.readdirSync(storage.path('recordings'));
  assert.equal(kept.length, 1);
  assert.match(kept[0], /^Grafana, round 1 \d{8}\.webm$/);
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
  assert.match(result.error, /requirements-transcribe/);
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
