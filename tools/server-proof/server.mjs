// The server proof's container: Chromium kept open on a filled fake form, a live view over a WebSocket (CDP screencast in, mouse and keys out), a reach check for public posting
// pages, the memory and CPU the container used, and the browser's storage (for the "move to my browser" test). Our own fake pages only get a Submit. Spec 2026-10-17-ready-to-send.md.
import fs from 'node:fs';
import http from 'node:http';
import {chromium} from 'playwright';
import {WebSocketServer} from 'ws';
import {handle} from './fake.mjs';

const TOKEN_OK = url => url.searchParams.get('t') || '';
let browser = null, held = null;   // held: {context, page, cdp, form, flow} the session kept open until "the user" comes
const launch = async () => browser || (browser = await chromium.launch({args: ['--no-sandbox']}));
const cg = name => { try { return Number(fs.readFileSync(`/sys/fs/cgroup/${name}`, 'utf8').trim()); } catch { return null; } };
const cpuUsec = () => { try { return Number(/usage_usec (\d+)/.exec(fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8'))[1]); } catch { return null; } };

// What the extension would have done by night: open the one-page form, fill the fields, stop before the human check; and walk the flow to its last step.
async function prepare(base) {
  const started = Date.now();
  const b = await launch();
  const context = await b.newContext({viewport: {width: 800, height: 700}});
  const page = await context.newPage();
  await page.goto(`${base}/fake/form`);
  await page.fill('#name', 'Alex Example'); await page.fill('#email', 'alex@example.invalid'); await page.fill('#notice', '2 months');
  await page.fill('#why', 'I run reliability work and like platform teams.');
  const fillMs = Date.now() - started;
  const flow = await context.newPage();
  await flow.goto(`${base}/flow/1`); await flow.fill('#name', 'Alex Example'); await flow.click('#go');
  await flow.waitForURL('**/flow/2'); await flow.fill('#more2', 'ten years'); await flow.click('#go'); await flow.waitForURL('**/flow/3');
  held = {context, page, flow, cdp: await context.newCDPSession(page), flowCdp: await context.newCDPSession(flow)};
  return {fillMs, totalMs: Date.now() - started};
}

// The live view: the first frame at once (a screenshot), then the screencast; input comes back as CDP events.
function attach(ws, which) {
  const target = which === 'flow' ? {page: held.flow, cdp: held.flowCdp} : {page: held.page, cdp: held.cdp};
  let seq = 0;
  const send = (data, kind) => ws.readyState === 1 && ws.send(JSON.stringify({kind, seq: ++seq, at: Date.now(), data}));
  (async () => {
    const shot = await target.cdp.send('Page.captureScreenshot', {format: 'jpeg', quality: 60});
    send(shot.data, 'first');
    target.cdp.on('Page.screencastFrame', async frame => { send(frame.data, 'frame'); await target.cdp.send('Page.screencastFrameAck', {sessionId: frame.sessionId}).catch(() => {}); });
    await target.cdp.send('Page.startScreencast', {format: 'jpeg', quality: 60, everyNthFrame: 1});
  })().catch(error => ws.send(JSON.stringify({kind: 'error', data: String(error)})));
  ws.on('message', async raw => {
    const m = JSON.parse(raw);
    try {
      if (m.t === 'mouse') await target.cdp.send('Input.dispatchMouseEvent', {type: m.type, x: m.x, y: m.y, button: m.button || 'none', clickCount: m.clickCount || 0, buttons: m.buttons || 0});
      else if (m.t === 'key') await target.cdp.send('Input.dispatchKeyEvent', {type: 'keyDown', text: m.text, key: m.text}).then(() => target.cdp.send('Input.dispatchKeyEvent', {type: 'keyUp', key: m.text}));
      else if (m.t === 'ping') ws.send(JSON.stringify({kind: 'pong', id: m.id}));
    } catch (error) { ws.send(JSON.stringify({kind: 'error', data: String(error)})); }
  });
  ws.on('close', () => target.cdp.send('Page.stopScreencast').catch(() => {}));
}

// A public posting page, loaded once in a fresh browser, read only: no click, no fill. What it met, how long it took.
async function reach(target) {
  const b = await launch();
  const context = await b.newContext({viewport: {width: 1280, height: 900}});
  const page = await context.newPage();
  const started = Date.now(); let status = 0, error = '';
  try { const response = await page.goto(target, {waitUntil: 'domcontentloaded', timeout: 30000}); status = response?.status() || 0; await page.waitForTimeout(3500); } catch (e) { error = String(e).slice(0, 120); }
  const info = await page.evaluate(() => {
    const text = (document.body?.innerText || '').slice(0, 4000).toLowerCase();
    const walls = ['just a moment', 'access denied', 'attention required', 'verify you are human', 'unusual traffic', 'are you a robot', 'captcha', 'enable javascript and cookies', 'request blocked', 'pardon our interruption'].filter(w => text.includes(w) || document.title.toLowerCase().includes(w));
    const fields = [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(e => e.offsetParent !== null).length;
    return {title: document.title.slice(0, 80), walls, fields, textLength: text.length};
  }).catch(() => ({title: '', walls: [], fields: 0, textLength: 0}));
  const final = page.url();
  await context.close();
  return {status, error, finalHost: new URL(final).host, ms: Date.now() - started, ...info};
}


// Option 2: the server walks the steps (account, earlier page), fills the last one, keeps it open, and hands over what a user's browser needs: the last step's address, the origin's storage
// (cookies, localStorage, sessionStorage), and a snapshot of the last page's values by field identity and the files by slot.
const handed = {};
async function handoff(base, variant) {
  const started = Date.now();
  const b = await launch();
  const context = await b.newContext({viewport: {width: 900, height: 800}});
  const page = await context.newPage();
  await page.goto(`${base}/apply/1?v=${variant}`);
  await page.fill('#acc-email', 'alex@example.invalid'); await page.fill('#acc-pass', 'Fake-pass-1'); await page.click('#go');
  await page.waitForURL('**/apply/2'); await page.fill('#years', '10'); await page.click('#go'); await page.waitForURL('**/apply/3');
  await page.fill('#name', 'Alex Example'); await page.fill('#email', 'alex@example.invalid'); await page.locator('#phone').pressSequentially('+41 79 000 00 00');
  await page.selectOption('#country', 'Switzerland'); await page.setInputFiles('#cv', {name: 'Alex_Example_CV.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake')}); await page.check('#consent');
  const walkMs = Date.now() - started;
  const snapshot = await page.evaluate(() => ({
    fields: [...document.querySelectorAll('input:not([type=file]),select,textarea')].map(e => ({id: e.id, name: e.name, type: e.type, value: e.type === 'checkbox' ? e.checked : e.value})),
    files: [...document.querySelectorAll('input[type=file]')].map(e => ({slot: e.id, name: e.files[0]?.name || '', size: e.files[0]?.size || 0}))}));
  const session = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(sessionStorage))));
  handed[variant] = {context, page};
  return {walkMs, url: page.url(), storage: await context.storageState(), sessionStorage: JSON.parse(session), snapshot};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString();
  if (handle(req, res, url, body)) return;
  const json = (code, data) => { res.writeHead(code, {'content-type': 'application/json'}); res.end(JSON.stringify(data)); };
  try {
    if (url.pathname === '/stats') return json(200, {mem_peak: cg('memory.peak'), mem_now: cg('memory.current'), cpu_usec: cpuUsec(), uptime_s: Math.round(process.uptime()), held: !!held});
    if (url.pathname === '/prepare') return json(200, await prepare(url.searchParams.get('base')));
    if (url.pathname === '/reach') return json(200, await reach(url.searchParams.get('url')));
    if (url.pathname === '/handoff') return json(200, await handoff(url.searchParams.get('base'), url.searchParams.get('v') || 'plain'));
    if (url.pathname === '/storage') return json(200, await held.context.storageState());
    res.writeHead(404); res.end('no');
  } catch (error) { json(500, {error: String(error).slice(0, 300)}); }
});
const wss = new WebSocketServer({noServer: true});
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (!held) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => attach(ws, url.searchParams.get('page') || 'form'));
});
server.listen(8080);
