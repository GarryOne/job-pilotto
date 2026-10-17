// Drives the server proof from outside (a CI runner, standing for the user's computer): prepare the filled session, open it through the live view 20 times, act in it like a person
// (mouse path, the human check, typing, Submit on OUR fake form), copy the browser's storage into a second browser ("move to my browser"), check ten public postings, read the container's use.
// Usage: node run.mjs <base url> <token> <out.json> [--local]   --local: the base is this machine (no container), the reach list is skipped.
import fs from 'node:fs';
import {chromium} from 'playwright';
import WebSocket from 'ws';

const [base, token, out] = process.argv.slice(2);
const local = process.argv.includes('--local');
const wsBase = base.replace(/^http/, 'ws');
const pct = (list, p) => { const s = [...list].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)]) : null; };
const get = async (path, query = '') => { const r = await fetch(`${base}${path}?t=${token}${query}`); return {status: r.status, json: await r.json().catch(() => null)}; };
const result = {base, at: new Date().toISOString()};
const attempt = async (name, fn) => { try { await fn(); } catch (e) { (result.errors ||= []).push(`${name}: ${String(e).slice(0, 300)}`); console.error(name, 'failed:', String(e).slice(0, 300)); } };

// 0. Wait for the container (cold start).
const t0 = Date.now(); let stats;
for (let n = 0; n < 60; n++) { try { stats = (await get('/stats')).json; if (stats) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 2000)); }
result.coldStartMs = Date.now() - t0;

// 1. The night: the session is filled and held.
await attempt('prepare', async () => { result.prepare = (await get('/prepare', `&base=${encodeURIComponent(base)}`)).json; if (!result.prepare || result.prepare.error) throw new Error(JSON.stringify(result.prepare)); });

// A live view connection: frames in, input out.
function connect(which = 'form') {
  return new Promise((resolve, reject) => {
    const started = Date.now(); const ws = new WebSocket(`${wsBase}/ws?t=${token}&page=${which}`);
    const view = {ws, frames: [], bytes: 0, waiters: []};
    ws.on('message', raw => {
      const m = JSON.parse(raw.toString()); const now = Date.now();
      if (m.kind === 'first' || m.kind === 'frame') {
        view.bytes += m.data.length * 0.75; view.frames.push(now);
        if (m.kind === 'first') resolve({view, firstMs: now - started});
        view.waiters.splice(0).forEach(w => w(now));
      }
      if (m.kind === 'pong') view.waiters.splice(0).forEach(w => w(now));
    });
    ws.on('unexpected-response', (req, res) => { let b = ''; res.on('data', d => { b += d; }); res.on('end', () => reject(new Error(`HTTP ${res.statusCode} ${b.slice(0, 200)}`))); });
    ws.on('error', reject); setTimeout(() => reject(new Error('no first frame in 20 s')), 20000);
  });
}
const nextFrame = (view, ms = 5000) => new Promise(resolve => { const timer = setTimeout(() => resolve(null), ms); view.waiters.push(at => { clearTimeout(timer); resolve(at); }); });
const input = (view, message) => view.ws.send(JSON.stringify(message));

// 2. "Click to a filled form you can use": open time, 20 times, each a fresh connection.
const opens = [];
await attempt('open', async () => { for (let n = 0; n < 20; n++) { const {view, firstMs} = await connect(); opens.push(firstMs); view.ws.close(); await new Promise(r => setTimeout(r, 300)); }
result.open = {samples: opens, p50: pct(opens, 0.5), p90: pct(opens, 0.9), max: Math.max(...opens)}; });

// 3. Act like a person in the stream: a mouse path to the human check, a click, typing, Submit.
await attempt('act', async () => {
  const {view} = await connect();
  await new Promise(r => setTimeout(r, 1200));   // the page's own dwell time
  const box = {x: 40, y: 0};   // the check's position is read from a fresh page load of the same page on this side
  const probe = await (await chromium.launch()).newContext({viewport: {width: 800, height: 700}}); const pp = await probe.newPage(); await pp.goto(`${base}/fake/form`);
  const rect = await pp.locator('#human').boundingBox(); const submit = await pp.locator('#submit').boundingBox(); const notice = await pp.locator('#notice').boundingBox();
  await probe.close();
  const at = r => ({x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)});
  const path = (from, to, steps = 12) => Array.from({length: steps}, (_, i) => ({x: Math.round(from.x + (to.x - from.x) * (i + 1) / steps), y: Math.round(from.y + (to.y - from.y) * (i + 1) / steps)}));
  for (const p of path({x: 400, y: 600}, at(rect))) { input(view, {t: 'mouse', type: 'mouseMoved', ...p}); await new Promise(r => setTimeout(r, 16)); }
  const click = at(rect);
  input(view, {t: 'mouse', type: 'mousePressed', ...click, button: 'left', clickCount: 1, buttons: 1}); input(view, {t: 'mouse', type: 'mouseReleased', ...click, button: 'left', clickCount: 1});
  await nextFrame(view);
  // typing latency: 20 keystrokes into the notice field, each time to the next frame
  const n = at(notice); input(view, {t: 'mouse', type: 'mousePressed', ...n, button: 'left', clickCount: 1, buttons: 1}); input(view, {t: 'mouse', type: 'mouseReleased', ...n, button: 'left', clickCount: 1});
  await nextFrame(view); const lat = [];
  for (const ch of ' (plus two weeks)') { const s = Date.now(); input(view, {t: 'key', text: ch}); const f = await nextFrame(view); if (f) lat.push(f - s); }
  result.inputLatency = {samples: lat.length, p50: pct(lat, 0.5), p90: pct(lat, 0.9)};
  const span = (view.frames.at(-1) - view.frames[0]) / 1000;
  result.stream = {frames: view.frames.length, seconds: Math.round(span), kbPerSecond: Math.round(view.bytes / 1024 / Math.max(span, 1))};
  const sub = at(submit); for (const p of path(click, sub)) { input(view, {t: 'mouse', type: 'mouseMoved', ...p}); await new Promise(r => setTimeout(r, 16)); }
  input(view, {t: 'mouse', type: 'mousePressed', ...sub, button: 'left', clickCount: 1, buttons: 1}); input(view, {t: 'mouse', type: 'mouseReleased', ...sub, button: 'left', clickCount: 1});
  await new Promise(r => setTimeout(r, 2500)); view.ws.close();
  result.submit = (await (await fetch(`${base}/fake/state`)).json());
});

// 4. "Move to my browser": the container's storage into a second browser (this machine's), then open the same pages.
await attempt('move', async () => {
  const state = (await get('/storage')).json;
  const mine = await chromium.launch(); const ctx = await mine.newContext({storageState: state}); const bare = await mine.newContext();
  const one = await ctx.newPage(); await one.goto(`${base}/fake/form`);
  const values = await one.evaluate(() => ['name', 'email', 'notice', 'why'].map(id => document.getElementById(id).value));
  const flow = await ctx.newPage(); await flow.goto(`${base}/flow/3`); const withCookies = await flow.locator('body').innerText();
  const control = await bare.newPage(); await control.goto(`${base}/flow/3`); const withoutCookies = await control.locator('body').innerText();
  const refill = Date.now(); for (const [id, v] of [['name', 'Alex Example'], ['email', 'alex@example.invalid'], ['notice', '2 months'], ['why', 'I run reliability work.']]) await one.fill(`#${id}`, v);
  result.move = {cookiesCopied: state.cookies.length, onePageValuesKept: values.filter(Boolean).length, refillLocalMs: Date.now() - refill,
    flowWithCookies: withCookies.replace(/\s+/g, ' ').slice(0, 90), flowWithoutCookies: withoutCookies.replace(/\s+/g, ' ').slice(0, 90)};
  await mine.close();
});


// 4b. Option 2: the server walked account -> step 2 -> step 3 and filled it. The user's browser (this machine) opens the LAST step with the session imported and the values restored by field identity.
const restoreIn = async (page, snapshot) => page.evaluate(snap => {
  const set = (el, value) => { const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); };
  let done = 0;
  for (const f of snap.fields) { const el = f.id && document.getElementById(f.id); if (!el) continue; if (f.type === 'checkbox') { if (el.checked !== f.value) el.click(); done++; } else if (f.value) { set(el, f.value); done++; } }
  return done;
}, snapshot);
result.handoff = [];
await attempt('handoff', async () => { for (const variant of ['plain', 'ip', 'ss']) {
  const h = (await get('/handoff', `&base=${encodeURIComponent(base)}&v=${variant}`)).json;
  const want = h.snapshot.fields.filter(f => (f.type === 'checkbox' ? f.value : f.value)).length;
  for (const mode of ['cookies', 'full']) {
    const mine = await chromium.launch(); const ctx = await mine.newContext({viewport: {width: 900, height: 800}, storageState: mode === 'full' ? h.storage : {cookies: h.storage.cookies, origins: []}});
    if (mode === 'full') await ctx.addInitScript(items => { for (const [k, v] of Object.entries(items)) if (!sessionStorage.getItem(k)) sessionStorage.setItem(k, v); }, h.sessionStorage);
    const page = await ctx.newPage(); const t = Date.now();
    await page.goto(h.url); const loaded = Date.now() - t;
    const kept = (await page.locator('#name').count()) > 0;
    const row = {variant, mode, sessionKept: kept, loadMs: loaded};
    if (kept) {
      const r0 = Date.now(); row.restored = await restoreIn(page, h.snapshot); row.wanted = want;
      for (const f of h.snapshot.files) if (f.name) await page.setInputFiles(`#${f.slot}`, {name: f.name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake')});
      row.restoreMs = Date.now() - r0; row.clickToRestoredMs = Date.now() - t;
      // the person: look, human check, Submit (our fake form)
      await page.waitForTimeout(900); await page.mouse.move(300, 500); await page.mouse.move(320, 460, {steps: 6}); const hb = await page.locator('#human').boundingBox(); await page.mouse.move(hb.x + 20, hb.y + 10, {steps: 8}); await page.mouse.click(hb.x + 20, hb.y + 10);
      const sb = await page.locator('#submit').boundingBox(); await page.mouse.move(sb.x + 10, sb.y + 5, {steps: 6}); await page.mouse.click(sb.x + 10, sb.y + 5);
      await page.waitForFunction(() => document.getElementById('msg').textContent.length > 0, null, {timeout: 5000}).catch(() => {});
      row.submitMessage = await page.locator('#msg').innerText().catch(() => '');
    } else row.pageSays = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 80);
    result.handoff.push(row); await mine.close();
  }
} });

// 5. Ten public postings, one read-only visit each, from the container's address.
const ROWS = [['Lever', 'https://jobs.lever.co/sonarsource/54743786-1ad7-4be7-bcbe-67f660e9c381'], ['Personio', 'https://seitenbau-gmbh.jobs.personio.de/job/2825574'], ['Recruitee', 'https://jobs.channable.com/o/talent-acquisition-partner'],
  ['Teamtailor', 'https://career.teamtailor.com/jobs/8297677-regional-director-csm'], ['Greenhouse', 'https://job-boards.eu.greenhouse.io/growe/jobs/4947699101'], ['Ashby', 'https://jobs.ashbyhq.com/pennylane/67967c1d-301a-4dd5-81af-44faa1d43021'],
  ['SmartRecruiters', 'https://jobs.smartrecruiters.com/Nexthink/744000154703604'], ['Workday', 'https://redhat.wd5.myworkdayjobs.com/jobs/job/Remote-US-NC/TDP-Architect---RHEL_R-054302-2'],
  ['SuccessFactors', 'https://careers.adnovum.com/job/Switzerland-Business-Application-Manager-%28a%29/116542435'], ['Workable', 'https://apply.workable.com/j/288875C2F2']];
result.reach = [];
await attempt('reach', async () => { if (!local) for (const [platform, url] of ROWS) { const r = (await get('/reach', `&url=${encodeURIComponent(url)}`)).json; result.reach.push({platform, ...r}); } });

// 6. What the container used.
result.stats = (await get('/stats')).json; result.statsFirst = stats; result.wallS = Math.round((Date.now() - t0) / 1000);
fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2).slice(0, 6000));
process.exit(0);
