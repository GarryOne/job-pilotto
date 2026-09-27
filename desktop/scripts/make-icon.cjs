// Renders the app icon (assets/icon.png, 1024 px) from the sidebar logo: a white ✈ on the signal-orange
// rounded square. Run once after changing the logo: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const html = `<html><body style="margin:0;background:transparent">
<div style="position:absolute;left:100px;top:100px;width:824px;height:824px;border-radius:185px;
  background:linear-gradient(160deg,#e0662f,#c2491b);display:grid;place-items:center;
  box-shadow:0 20px 40px rgba(0,0,0,.25)">
  <span style="color:#fff;font:560px -apple-system,'Helvetica Neue',sans-serif;line-height:1;transform:translateY(-12px)">✈</span>
</div></body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false,
    useContentSize: true, webPreferences: { offscreen: true } });
  win.webContents.setZoomFactor(1);
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise(resolve => setTimeout(resolve, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.png'), image.resize({ width: 1024, height: 1024 }).toPNG());
  app.quit();
});
