// Electron main for test/shot-mark.test.js: a tiny page with one box, the --mark steps run on it, and the pixels read back as JSON (the frame's edge, the box's inside, far outside).
const {app, BrowserWindow} = require('electron');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const {markSteps} = await import(process.env.MARK_MODULE);
  const win = new BrowserWindow({show: false, width: 300, height: 200, webPreferences: {offscreen: true}});
  await win.loadURL('data:text/html,<body style="margin:0;background:white"><div id="box" style="position:absolute;left:100px;top:60px;width:80px;height:40px;background:white"></div>');
  const error = await win.webContents.executeJavaScript(`(async () => { ${markSteps(['#box', '#missing'].slice(0, Number(process.env.MARK_COUNT)))} })().then(() => null, e => e.message)`);
  await new Promise(resolve => setTimeout(resolve, 300));
  const image = await win.webContents.capturePage(), {width} = image.getSize(), bitmap = image.toBitmap();
  const scale = width / 300, pixel = (x, y) => { const at = (Math.round(y * scale) * width + Math.round(x * scale)) * 4; return [bitmap[at + 2], bitmap[at + 1], bitmap[at]]; };
  console.log('PROBE ' + JSON.stringify({error, frame: pixel(98, 80), inside: pixel(140, 80), outside: pixel(20, 20)}));
  app.quit();
});
