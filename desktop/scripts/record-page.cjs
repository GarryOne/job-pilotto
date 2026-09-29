// Records a web page as frames while it animates (Electron offscreen, a fixed frame rate), for the website's videos.
// Env: RECORD_FILE (html), RECORD_OUT (folder for f00001.png…), RECORD_FPS (20), RECORD_W/H (layout size), RECORD_SCALE.
// Stops when the page sets window.done (or after RECORD_MAX seconds). Run by scripts/apply-demo.mjs.
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const fps = Number(process.env.RECORD_FPS || 20), scale = Number(process.env.RECORD_SCALE || 1.25);
const width = Number(process.env.RECORD_W || 1280), height = Number(process.env.RECORD_H || 800);
const out = process.env.RECORD_OUT, max = Number(process.env.RECORD_MAX || 40) * 1000;
app.whenReady().then(async () => {
  fs.mkdirSync(out, {recursive: true});
  const win = new BrowserWindow({width: Math.round(width * scale), height: Math.round(height * scale), show: false,
    webPreferences: {offscreen: true}});
  let latest = null, n = 0;
  win.webContents.on('paint', (_event, _dirty, image) => { latest = image; });
  win.webContents.setFrameRate(fps);
  await win.loadFile(process.env.RECORD_FILE);
  win.webContents.setZoomFactor(scale);  // laid out at width × height, drawn sharper
  const started = Date.now();
  const timer = setInterval(async () => {
    if (latest) fs.writeFileSync(path.join(out, `f${String(++n).padStart(5, '0')}.png`), latest.toPNG());
    const done = await win.webContents.executeJavaScript('!!window.done').catch(() => false);
    if (done || Date.now() - started > max) { clearInterval(timer); console.log(`${n} frames`); app.quit(); }
  }, 1000 / fps);
});
