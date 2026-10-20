// E2E only (JOB_PILOTTO_E2E_HIDDEN=1, set by e2e/lib/app.mjs): the app runs with hidden windows and never takes focus, so a test run
// does not pull the app, a PDF or a browser tab in front of the terminal or browser the person is typing in. Playwright still clicks,
// types and screenshots a hidden window. On by default only on a Mac outside CI (CI is unchanged); E2E_HIDDEN=0 to watch a run.
// A screenshot run (JOB_PILOTTO_SMOKE=<png>, npm run shot, ui-shots, drawer-shots, screenshots) is hidden the same way (17 Oct 2026: several
// at once left "Electron" icons in the Dock and took focus); capturePage works on a window that was never shown.
export const hiddenRun = (env = process.env) => (!!env.JOB_PILOTTO_E2E && env.JOB_PILOTTO_E2E_HIDDEN === '1') || !!env.JOB_PILOTTO_SMOKE;
// A screenshot run loads its page marked `?capture=1` (owner, 17 Oct 2026: the first-launch tour covered the sidebar in PR shots): the renderer leaves out
// one-time overlays (renderer/menu-tour.js captureRun). Never for a user or an e2e run, which must see what a user sees.
export const captureQuery = (env = process.env) => (env.JOB_PILOTTO_SMOKE ? {capture: '1'} : undefined);

export function hideWindows({app, BrowserWindow, shell, env = process.env, platform = process.platform}) {
  if (!hiddenRun(env)) return false;
  for (const name of ['show', 'focus', 'moveTop']) BrowserWindow.prototype[name] = function () {};
  app.focus = () => {};
  if (platform === 'darwin') app.setActivationPolicy('accessory');   // no Dock icon or menu bar, never the active app
  // Files and links the app would hand to Preview, Finder or the browser: kept here instead (suites may stub these again).
  globalThis.__e2eShell = [];
  for (const name of ['openPath', 'openExternal', 'showItemInFolder']) {
    shell[name] = async target => { globalThis.__e2eShell.push({name, target: String(target)}); return name === 'openPath' ? '' : undefined; };
  }
  return true;
}
