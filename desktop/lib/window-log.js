// What happened to the main window, in logs/app.log (area `window`): how long it took to load, a load that failed, the
// renderer crashing or freezing, an error thrown while it starts, and a window still blank some seconds after loading.
// 3 Oct 2026: the first start after an update showed an empty window for minutes and nothing was written down, so the
// cause could not be found. Error texts are the code's own messages (capped), never page content.

const BLANK_CHECK = "document.querySelectorAll('.view:not([hidden])').length";   // a page is up when one view shows
const MAX_ERRORS = 20;   // a broken page can throw on every frame: the first ones say enough

export function watchWindow(contents, {log, now = Date.now, setTimer = setTimeout, loadTimeoutMs = 30000, blankAfterMs = 15000, label = 'main'} = {}) {
  const started = now();
  let loaded = false, errors = 0;
  const seconds = () => Math.round((now() - started) / 100) / 10;
  const alive = () => !contents.isDestroyed?.();
  contents.on('did-finish-load', () => {
    loaded = true;
    log('window', `${label}: loaded in ${seconds()} s`);
    setTimer(async () => {
      if (!alive()) return;
      const shown = await contents.executeJavaScript(BLANK_CHECK).catch(error => `check failed: ${error.message}`);
      if (shown === 0) log('window', `${label}: still blank ${Math.round(blankAfterMs / 1000)} s after loading (no page shown): see the errors above`);
      else if (typeof shown === 'string') log('window', `${label}: blank check failed`, {error: shown.slice(0, 200)});
    }, blankAfterMs);
  });
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame !== false) log('window', `${label}: load failed`, {code, error: String(description).slice(0, 200), file: String(url).split('/').slice(-2).join('/')});
  });
  contents.on('render-process-gone', (_event, details) => log('window', `${label}: renderer gone`, {reason: details?.reason, exitCode: details?.exitCode, error: 'renderer gone'}));
  contents.on('unresponsive', () => log('window', `${label}: not responding (error)`));
  contents.on('responsive', () => log('window', `${label}: responding again`));
  contents.on('preload-error', (_event, file, error) => log('window', `${label}: preload failed`, {file: String(file).split('/').pop(), error: String(error?.message || error).slice(0, 200)}));
  contents.on('console-message', (...args) => {
    // Electron passes (event) with its fields on newer versions, (event, level, message, line, source) on older ones.
    const event = args[0] || {};
    const level = event.level ?? args[1], message = event.message ?? args[2], line = event.lineNumber ?? args[3], source = event.sourceId ?? args[4];
    if (!(level === 'error' || level === 3) || ++errors > MAX_ERRORS) return;
    log('window', `${label}: page error`, {error: String(message).slice(0, 300), at: `${String(source || '').split('/').pop()}:${line ?? '?'}`});
  });
  setTimer(() => { if (!loaded && alive()) log('window', `${label}: not loaded after ${Math.round(loadTimeoutMs / 1000)} s (error)`); }, loadTimeoutMs);
}

// The first start of a new version says so (and from which one), so a problem right after an update can be told apart.
export function versionLine(storage, version, build = '') {
  const previous = storage.settings().lastStartedVersion;
  if (previous === version) return null;
  storage.saveSettings({lastStartedVersion: version});
  return previous ? `first start of ${version}${build ? ` (${build})` : ''}, updated from ${previous}` : `first start of ${version}${build ? ` (${build})` : ''}`;
}
