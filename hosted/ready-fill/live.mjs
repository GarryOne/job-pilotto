// The morning's two ways in to a filled tab (spec docs/superpowers/specs/2026-10-17-ready-to-send.md; measured by the server proof, 17 Oct 2026: open p50 155 ms, input p50 79 ms, hand-off restore 5 of 5 in ~10 ms):
//  - the LIVE VIEW: a CDP screencast of the tab over a WebSocket, the person's mouse and keys coming back as CDP input. He solves a human check and presses Submit in it; nothing here presses anything on its own.
//  - the HAND-OFF: what his own browser needs to open the same page filled: the address, the browser's storage (cookies, localStorage, sessionStorage) and a snapshot of the page's fields and file slots by identity.
// Pure parts are exported for the tests; the page-facing ones take a Playwright page. Guard: desktop/test/ready-fill.test.js.

// Pure: the input message from the viewer -> a CDP call [method, params], or null for something unknown. Only mouse and key input pass; nothing else reaches the browser.
export function inputToCdp(message) {
  if (message?.t === 'mouse' && ['mouseMoved', 'mousePressed', 'mouseReleased', 'mouseWheel'].includes(message.type)) {
    return ['Input.dispatchMouseEvent', {type: message.type, x: Number(message.x) || 0, y: Number(message.y) || 0, button: message.button || 'none', clickCount: message.clickCount || 0, buttons: message.buttons || 0,
      ...(message.type === 'mouseWheel' ? {deltaX: Number(message.deltaX) || 0, deltaY: Number(message.deltaY) || 0} : {})}];
  }
  if (message?.t === 'key' && typeof message.key === 'string' && message.key.length <= 32) return ['Input.dispatchKeyEvent', {type: message.up ? 'keyUp' : 'keyDown', key: message.key, text: message.up ? undefined : message.text, windowsVirtualKeyCode: message.code || undefined}];
  return null;
}

// ws: a WebSocket (the `ws` package); page: the held tab. The first frame is a screenshot at once, then the screencast.
export async function attach(ws, page) {
  const cdp = await page.context().newCDPSession(page);
  let seq = 0;
  const send = (data, kind) => ws.readyState === 1 && ws.send(JSON.stringify({kind, seq: ++seq, at: Date.now(), data}));
  cdp.on('Page.screencastFrame', async frame => { send(frame.data, 'frame'); await cdp.send('Page.screencastFrameAck', {sessionId: frame.sessionId}).catch(() => {}); });
  send((await cdp.send('Page.captureScreenshot', {format: 'jpeg', quality: 60})).data, 'first');
  await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 60, everyNthFrame: 1});
  ws.on('message', async raw => {
    let message; try { message = JSON.parse(raw); } catch { return; }
    if (message.t === 'ping') return ws.send(JSON.stringify({kind: 'pong', id: message.id}));
    const call = inputToCdp(message);
    if (call) await cdp.send(...call).catch(error => ws.send(JSON.stringify({kind: 'error', data: String(error).slice(0, 200)})));
  });
  ws.on('close', () => { cdp.send('Page.stopScreencast').catch(() => {}); cdp.detach().catch(() => {}); });
}

// The hand-off for a held tab. The snapshot has field identity and value, never read back anywhere but the owner's own browser.
export async function handoff(page) {
  const snapshot = await page.evaluate(() => ({
    fields: [...document.querySelectorAll('input:not([type=file]):not([type=password]),select,textarea')].map(e => ({id: e.id, name: e.name, type: e.type, value: e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value})),
    files: [...document.querySelectorAll('input[type=file]')].map(e => ({slot: e.id || e.name, name: e.files[0]?.name || '', size: e.files[0]?.size || 0}))}));
  const session = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))).catch(() => '{}');
  return {url: page.url(), storage: await page.context().storageState(), sessionStorage: JSON.parse(session), snapshot};
}
