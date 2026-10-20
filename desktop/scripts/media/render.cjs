/* global document, createImageBitmap, Path2D, Blob */
// Draws a product video from recorded frames (desktop/scripts/media): each output frame is a recorded frame moved and scaled through the camera
// (a float transform, so pans are smooth), plus a cursor and a click ring. The app's pixels are never redrawn. Electron's canvas does the drawing in a
// hidden window; raw pixels go to ffmpeg, which writes one high-quality master (encode.mjs makes the site's files from it).
// Run by media.mjs: electron render.cjs <job.json>. job: {framesDir, frames: [{file, x, y, w, h, cx, cy, press}], scale, width, height, fps, out, ffmpeg}
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');

const job = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'));

// Runs inside the hidden window (nodeIntegration): a canvas, the frames drawn in order, raw RGBA to ffmpeg's stdin.
async function draw(job) {
  const fs = require('node:fs'), path = require('node:path'), {spawn} = require('node:child_process');
  const canvas = document.createElement('canvas');
  canvas.width = job.width; canvas.height = job.height;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const ffmpeg = spawn(job.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${job.width}x${job.height}`,
    '-r', String(job.fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', job.out], {stdio: ['pipe', 'ignore', 'pipe']});
  let error = '';
  ffmpeg.stderr.on('data', chunk => { error += chunk; });
  const done = new Promise(resolve => ffmpeg.on('close', resolve));
  const write = buffer => new Promise(resolve => { if (ffmpeg.stdin.write(buffer)) resolve(); else ffmpeg.stdin.once('drain', resolve); });
  const s = job.scale, unit = job.width / 1600;   // frame px per page CSS px; the cursor's size follows the output width
  let file = null, bitmap = null;
  for (const frame of job.frames) {
    if (frame.file !== file) {
      bitmap?.close();
      bitmap = await createImageBitmap(new Blob([fs.readFileSync(path.join(job.framesDir, frame.file))], {type: 'image/jpeg'}));
      file = frame.file;
    }
    ctx.drawImage(bitmap, frame.x * s, frame.y * s, frame.w * s, frame.h * s, 0, 0, job.width, job.height);
    const px = (frame.cx - frame.x) * job.width / frame.w, py = (frame.cy - frame.y) * job.height / frame.h;
    if (frame.press != null && frame.press < job.ring) {   // the click ring: grows and fades
      const k = frame.press / job.ring;
      ctx.beginPath(); ctx.arc(px, py, (16 + 50 * k) * unit, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 150, 60, ${0.9 * (1 - k)})`; ctx.lineWidth = 4 * unit; ctx.stroke();
    }
    if (frame.cursor !== false) {
      const c = 1.3 * unit * (frame.press != null && frame.press < 0.12 ? 0.88 : 1);   // pressed: a touch smaller
      ctx.save(); ctx.translate(px, py); ctx.scale(c, c);
      const arrow = new Path2D('M0 0 L0 24 L6 18.5 L10.5 28 L14 26.5 L9.8 17.3 L17.5 17.3 Z');
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1.5;
      ctx.fillStyle = '#ffffff'; ctx.fill(arrow);
      ctx.shadowColor = 'transparent'; ctx.lineWidth = 1.4; ctx.strokeStyle = '#111111'; ctx.stroke(arrow);
      ctx.restore();
    }
    await write(Buffer.from(ctx.getImageData(0, 0, job.width, job.height).data.buffer));
  }
  ffmpeg.stdin.end();
  const code = await done;
  if (code !== 0) throw new Error(`ffmpeg ${code}: ${error.slice(-400)}`);
  return job.frames.length;
}

app.disableHardwareAcceleration();   // the same pixels on every Mac and runner
app.whenReady().then(async () => {
  const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false}});
  await win.loadURL('about:blank');
  try {
    const frames = await win.webContents.executeJavaScript(`(${draw.toString()})(${JSON.stringify(job)})`);
    console.log(`rendered ${frames} frames`);
    app.exit(0);
  } catch (error) {
    console.error(`render failed: ${error.message}`);
    app.exit(1);
  }
});
