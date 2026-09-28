// The call's audio for the interview recorder, through AudioTee (Core Audio taps, macOS 14.2+): it needs only
// macOS's "System Audio Recording Only" permission, not Screen Recording. Output: raw 16-bit mono PCM at 16 kHz
// in the draft's folder (call.pcm), next to the microphone recording; transcribe.py lines the two up.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './root.js';

// Packaged: <app>/Contents/Resources/pilot/bin/audiotee; development: desktop/build/bin (scripts/audiotee.sh).
export function binary(root = ROOT) {
  for (const candidate of [path.join(root, 'bin', 'audiotee'), path.join(root, 'desktop', 'build', 'bin', 'audiotee')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// Loudest sample of a chunk of 16-bit little-endian PCM, 0..1.
export function peak(chunk) {
  let max = 0;
  for (let i = 0; i + 1 < chunk.length; i += 2) max = Math.max(max, Math.abs(chunk.readInt16LE(i)));
  return max / 32768;
}

const taps = new Map();

// Start tapping into `file`. onLevel(peak) about 5 times a second. Resolves {startedAt} once audio flows,
// or rejects when AudioTee fails to start (no binary, macOS too old).
export function start(id, file, onLevel = () => {}, run = spawn, exe = binary()) {
  if (!exe) return Promise.reject(new Error('AudioTee is not built'));
  if (taps.has(id)) return Promise.resolve({startedAt: taps.get(id).startedAt});
  return new Promise((resolve, reject) => {
    const child = run(exe, ['--sample-rate', '16000', '--chunk-duration', '0.2'], {stdio: ['ignore', 'pipe', 'pipe']});
    const out = fs.createWriteStream(file, {mode: 0o600});
    const tap = {child, out, startedAt: null, errors: []};
    taps.set(id, tap);
    child.stdout.on('data', chunk => {
      if (!tap.startedAt) { tap.startedAt = Date.now() - 200; resolve({startedAt: tap.startedAt}); }
      out.write(chunk);
      onLevel(peak(chunk));
    });
    child.stderr.on('data', data => {
      for (const line of String(data).split('\n')) {
        try { const message = JSON.parse(line); if (message.message_type === 'error') tap.errors.push(message.data?.message || line); } catch {}
      }
    });
    child.on('error', error => { taps.delete(id); out.end(); reject(error); });
    child.on('close', code => {
      if (!tap.startedAt) { taps.delete(id); out.end(); reject(new Error(tap.errors.pop() || `AudioTee stopped (${code})`)); }
    });
  });
}

// Stop and close the file; resolves when everything is written.
export function stop(id) {
  const tap = taps.get(id);
  if (!tap) return Promise.resolve(null);
  taps.delete(id);
  return new Promise(resolve => {
    tap.child.once('close', () => tap.out.end(() => resolve({startedAt: tap.startedAt})));
    tap.child.kill('SIGTERM');
  });
}
