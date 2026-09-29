// The website's "How automatic apply works" videos, recorded in real time from staged pages (a Greenhouse-style form,
// the extension's own panel, a fictional candidate), never a real profile:
//   apply-demo.mp4   the browser: the extension fills the form            (site/demo/apply-demo.html)
//   apply-split.mp4  both sides: the browser and Job Pilotto on the Mac, in sync  (site/demo/apply-split.html)
// → site/public/images/app/<name>.mp4 + <name>-poster.jpg.   Run: npm run apply-demo
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(desktop, '..', 'site');
const electron = path.join(desktop, 'node_modules', '.bin', 'electron');
const out = path.join(site, 'public', 'images', 'app');
const fps = 20;
const VIDEOS = [['apply-demo', 'apply-demo.html', 1280, 800, 1600], ['apply-split', 'apply-split.html', 1760, 800, 1920]];
const only = process.argv.slice(2);
for (const [name, page, width, height, videoWidth] of VIDEOS.filter(([name]) => !only.length || only.includes(name))) {
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), `jp-${name}-`));
  const run = spawnSync(electron, [path.join(desktop, 'scripts', 'record-page.cjs')], {stdio: 'inherit',
    env: {...process.env, RECORD_FILE: path.join(site, 'demo', page), RECORD_OUT: frames, RECORD_FPS: String(fps),
      RECORD_W: String(width), RECORD_H: String(height)}});
  if (run.status !== 0) process.exit(run.status || 1);
  const all = fs.readdirSync(frames).filter(f => f.endsWith('.png')).sort();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(frames, 'f%05d.png'),
    '-vf', `scale=${videoWidth}:-2,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-movflags', '+faststart', '-an',
    path.join(out, `${name}.mp4`)]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(frames, all[all.length - 1]), '-vf', `scale=${videoWidth}:-2`, '-q:v', '4',
    path.join(out, `${name}-poster.jpg`)]);
  fs.rmSync(frames, {recursive: true, force: true});
  console.log(`${name}.mp4: ${all.length} frames, ${(all.length / fps).toFixed(1)} s, ${(fs.statSync(path.join(out, `${name}.mp4`)).size / 1024).toFixed(0)} KB`);
}
