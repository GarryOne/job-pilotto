// The site's files from a rendered master (desktop/scripts/media): MP4 (H.264, every browser) and WebM (VP9) within the piece's byte budget,
// a phone copy, a GIF, a poster (the first frame, or the scene's poster hold), and WebP stills. ffmpeg from PATH (brew on the CI runner).
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ff = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {stdio: ['ignore', 'ignore', 'pipe']});
const size = file => fs.statSync(file).size;

// The first quality (CRF) whose file fits the budget: from sharp to small, two steps at a time. Pure.
export const crfLadder = (from, to) => Array.from({length: Math.floor((to - from) / 2) + 1}, (_, i) => from + 2 * i);

function withinBudget(make, file, budget, ladder) {
  for (const crf of ladder) { make(crf); if (!budget || size(file) <= budget) return crf; }
  throw new Error(`media: ${path.basename(file)} is ${(size(file) / 1e6).toFixed(2)} MB at the lowest quality, over its ${(budget / 1e6).toFixed(2)} MB budget (shorten the scene)`);
}

// The encoders every piece needs; a missing one stops the run before any recording (an ffmpeg built without WebP, run 39451422713).
export const ENCODERS = ['libx264', 'libvpx-vp9', 'libwebp'];
export function missingEncoders(list = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {encoding: 'utf8'})) {
  return ENCODERS.filter(name => !new RegExp(`\\s${name}\\s`).test(list));   // whole names: libwebp_anim is not libwebp
}

// -> {mp4, webm, poster, phone?, gif?}: file names in outDir, plus the bytes of each.
export function encodeVideo({master, name, piece, outDir, posterAt = 0}) {
  const files = {mp4: `${name}.mp4`, webm: `${name}.webm`, poster: `${name}-poster.jpg`};
  const at = file => path.join(outDir, file);
  const scale = `scale=${piece.width}:${piece.height}:flags=lanczos`;
  withinBudget(crf => ff('-i', master, '-vf', `${scale},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-movflags', '+faststart', '-an', at(files.mp4)),
    at(files.mp4), piece.budget, crfLadder(22, 34));
  withinBudget(crf => ff('-i', master, '-vf', scale, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-an', at(files.webm)),
    at(files.webm), piece.budget, crfLadder(34, 50));
  ff('-ss', String(posterAt), '-i', master, '-vf', scale, '-frames:v', '1', '-q:v', '3', at(files.poster));
  if (piece.phone) {
    files.phone = `${name}-${piece.phone}.mp4`;
    ff('-i', master, '-vf', `scale=${piece.phone}:-2:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-movflags', '+faststart', '-an', at(files.phone));
  }
  if (piece.gif) {   // emails and READMEs: 10 fps, one palette for the whole clip, only changed areas redrawn
    files.gif = `${name}.gif`;
    ff('-i', master, '-vf', `fps=10,scale=${piece.gif}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, at(files.gif));
  }
  return {files, bytes: Object.fromEntries(Object.entries(files).map(([kind, file]) => [kind, size(at(file))]))};
}

// A still (the whole window, 1600 wide) or a close-up (kept at 2x) as WebP. -> {file, bytes, width, height}
export function encodeStill({png, name, kind, outDir}) {
  const file = `${kind}-${name}.webp`;
  ff('-i', png, ...(kind === 'still' ? ['-vf', 'scale=1600:-2:flags=lanczos'] : []), '-c:v', 'libwebp', '-quality', '84', path.join(outDir, file));
  const [width, height] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(outDir, file)], {encoding: 'utf8'}).trim().split(',').map(Number);
  return {file, bytes: size(path.join(outDir, file)), width, height};
}

// Seconds of a video file.
export const duration = file => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {encoding: 'utf8'}).trim());

// The mean brightness of an image, 0..1 (the dark-theme check).
export function brightness(file) {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'scale=64:-2,format=gray', '-frames:v', '1', '-f', 'rawvideo', '-'], {maxBuffer: 1e7});
  return raw.reduce((sum, value) => sum + value, 0) / raw.length / 255;
}
