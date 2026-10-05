// E2E only (JOB_PILOTTO_E2E_HIDDEN=1, set by e2e/lib/app.mjs): the app runs with hidden windows and never takes focus, so a test run
// does not pull the app, a PDF or a browser tab in front of the terminal or browser the person is typing in. Playwright still clicks,
// types and screenshots a hidden window. On by default only on a Mac outside CI (CI is unchanged); E2E_HIDDEN=0 to watch a run.
export const hiddenRun = (env = process.env) => !!env.JOB_PILOTTO_E2E && env.JOB_PILOTTO_E2E_HIDDEN === '1';

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
