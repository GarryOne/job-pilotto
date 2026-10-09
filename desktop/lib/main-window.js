// The app's windows (moved out of main.js, 8 Oct 2026): the main window (its size, theme background, the page it loads, what it does when closed or when its page
// fails), the Notion window with its own session, and the light, dark or system theme. The window itself stays owned by main.js: it is read through
// a getter and set through a setter. Guards: the window, theme and smoke tests in desktop/test.
import * as devMarker from './dev-marker.js';
import * as terminals from './terminals.js';
import fs from 'node:fs';
import path from 'node:path';
import {log as appLog} from './log.js';
import {watchWindow} from './window-log.js';

// The narrowest window: about half of a 14-inch MacBook's screen (1352–1512 px), so Job Pilotto and Chrome fit side by side (owner, 9 Oct 2026).
export const MIN_WIDTH = 640;
export function createMainWindow(ctx) {
  const {BrowserWindow, DEMO, HIDDEN, app, here, nativeTheme, shell, getWindow, setWindow} = ctx;
  const win = {get window() { return getWindow(); }, set window(value) { setWindow(value); }};   // main.js owns the window: read and set through it
  // Notion inside the app: its own window (Notion refuses to be shown in an iframe). The session is kept
  // (partition persist:notion), so the user signs in to Notion once; links to other sites open in the browser.
  let notionWindow = null;
  function openNotion(url) {
    if (!/^https:\/\/(www\.)?notion\.(so|site)\//.test(url)) return shell.openExternal(url);
    if (!notionWindow || notionWindow.isDestroyed()) {
      notionWindow = new BrowserWindow({width: 1280, height: 860, title: 'Notion · Job Pilotto', show: !HIDDEN,   // about Notion
        webPreferences: {partition: 'persist:notion', contextIsolation: true, sandbox: true}});
      const outside = target => !/^https:\/\/([a-z0-9-]+\.)*notion\.(so|site|com)\//.test(target);
      notionWindow.webContents.setWindowOpenHandler(({url: target}) => {
        if (outside(target)) { shell.openExternal(target); return {action: 'deny'}; }
        notionWindow.loadURL(target);
        return {action: 'deny'};
      });
    }
    notionWindow.loadURL(url);
    notionWindow.show();
    notionWindow.focus();
  }

  // Theme (Settings → Appearance): 'system', 'light' or 'dark'. Electron's theme source makes the window's
  // prefers-color-scheme follow it, so tokens.css switches; the window's own background matches (no flash).
  // JOB_PILOTTO_THEME=light|dark forces one (screenshots of the dark screens in demo mode).
  function applyTheme(value) {
    const theme = ['light', 'dark'].includes(value) ? value : 'system';
    nativeTheme.themeSource = theme;
    if (win.window && !win.window.isDestroyed()) win.window.setBackgroundColor(windowBackground());
    return theme;
  }
  function windowBackground() { return nativeTheme.shouldUseDarkColors ? '#0b1016' : '#eef3f7'; }

  function createWindow() {
    const windowTitle = devMarker.title(!app.isPackaged && !DEMO, app.isPackaged ? '' : devMarker.branch(here));
    win.window = new BrowserWindow({
      width: Number(process.env.JOB_PILOTTO_SHOT_WIDTH) || 1280, height: 820, minWidth: Math.min(MIN_WIDTH, Number(process.env.JOB_PILOTTO_SHOT_WIDTH) || MIN_WIDTH), minHeight: 640, title: windowTitle, show: !process.env.JOB_PILOTTO_SMOKE && !HIDDEN,
      backgroundColor: windowBackground(),
      webPreferences: {preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: !HIDDEN},   // hidden e2e window: still animates, so Playwright's clicks don't wait
    });
    watchWindow(win.window.webContents, {log: appLog});   // load time, load failures, crashes, freezes, page errors, a blank window
    win.window.on('page-title-updated', event => { event.preventDefault(); win.window.setTitle(windowTitle); });
    // Demo mode can open another page of the app instead, e.g. the component gallery (npm run gallery).
    const page = DEMO && /^[a-z-]+\.html$/.test(process.env.JOB_PILOTTO_PAGE || '') ? process.env.JOB_PILOTTO_PAGE : 'index.html';
    win.window.loadFile(path.join(here, 'renderer', page));
    // Closed on the Mac, the app keeps running: forget the destroyed window so nothing calls into it.
    const opened = win.window;
    opened.on('closed', () => { appLog('window', 'main: closed'); if (win.window === opened) win.window = null; });
    // Smoke test of the in-app terminal (JOB_PILOTTO_PTY_SMOKE=<file>): a real pseudo-terminal runs a shell command;
    // its output (or the error) goes to the file. The Windows build checks it in the installed app.
    if (process.env.JOB_PILOTTO_PTY_SMOKE) {
      const out = process.env.JOB_PILOTTO_PTY_SMOKE;
      const [file, args] = process.platform === 'win32' ? [process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'echo pty-ok']] : ['/bin/sh', ['-c', 'echo pty-ok']];
      terminals.start({id: 'smoke', url: 'https://smoke', file, args, cwd: app.getPath('home'), env: process.env})
        .then(() => setTimeout(() => fs.writeFileSync(out, terminals.output('smoke') || 'no output'), 3000))
        .catch(error => fs.writeFileSync(out, `error: ${error.message}`));
    }
    // Smoke test (JOB_PILOTTO_SMOKE=<png path>): render hidden, save a screenshot, quit.
    if (process.env.JOB_PILOTTO_SMOKE) {
      win.window.webContents.once('did-finish-load', () => setTimeout(async () => {
        // JOB_PILOTTO_SMOKE_JS: clicks to run first, e.g. to screenshot a later wizard step.
        if (process.env.JOB_PILOTTO_SMOKE_JS) {
          await win.window.webContents.executeJavaScript(process.env.JOB_PILOTTO_SMOKE_JS);
          await new Promise(resolve => setTimeout(resolve, 400));
        }
        // JOB_PILOTTO_SMOKE_RELOAD_JS: reload the window (⌘R), then run these steps (a bug that shows only after a reload).
        if (process.env.JOB_PILOTTO_SMOKE_RELOAD_JS) {
          await new Promise(resolve => { win.window.webContents.once('did-finish-load', resolve); win.window.webContents.reload(); });
          await new Promise(resolve => setTimeout(resolve, 1500));
          await win.window.webContents.executeJavaScript(process.env.JOB_PILOTTO_SMOKE_RELOAD_JS);
          await new Promise(resolve => setTimeout(resolve, 400));
        }
        // JOB_PILOTTO_SMOKE_EVAL: an expression evaluated in the window (window.__jp has its state); the result goes as
        // JSON to <JOB_PILOTTO_SMOKE>.json. Reading state is faster and exacter than looking at a picture.
        if (process.env.JOB_PILOTTO_SMOKE_EVAL) {
          const value = await win.window.webContents.executeJavaScript(`(async () => JSON.stringify(await (${process.env.JOB_PILOTTO_SMOKE_EVAL}), null, 2))()`)
            .catch(error => JSON.stringify({error: String(error.message || error)}));
          fs.writeFileSync(`${process.env.JOB_PILOTTO_SMOKE}.json`, value ?? 'null');
        }
        if (process.env.JOB_PILOTTO_SMOKE_NO_PICTURE) { app.quit(); return; }
        // JOB_PILOTTO_SMOKE_SELECTOR: only that element (and a small margin), e.g. for the website's close-ups.
        const selector = process.env.JOB_PILOTTO_SMOKE_SELECTOR;
        const rect = selector ? await win.window.webContents.executeJavaScript(`(() => {
          const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return null;
          node.scrollIntoView({block: 'nearest'}); const r = node.getBoundingClientRect(), m = ${Number(process.env.JOB_PILOTTO_SMOKE_MARGIN ?? 12)};
          if (!r.width || !r.height) return null;
          return {x: Math.max(0, Math.floor(r.left - m)), y: Math.max(0, Math.floor(r.top - m)),
            width: Math.min(innerWidth, Math.ceil(r.width + 2 * m)), height: Math.min(innerHeight - Math.max(0, r.top - m), Math.ceil(r.height + 2 * m))};
        })()`) : null;
        if (selector && !rect) { console.error(`smoke: no element matches ${selector}`); app.quit(); return; }
        fs.writeFileSync(process.env.JOB_PILOTTO_SMOKE, (await (rect ? win.window.webContents.capturePage(rect) : win.window.webContents.capturePage())).toPNG());
        app.quit();
      }, 1500));
    }
    // Links open in the user's browser, never inside the app.
    win.window.webContents.setWindowOpenHandler(({url}) => { shell.openExternal(url); return {action: 'deny'}; });
  }
  return {notionWindow, openNotion, applyTheme, windowBackground, createWindow};
}
