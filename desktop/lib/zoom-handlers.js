// The window's zoom (lib/zoom.js has the rules): applied at every load, changed by the View menu's ⌘- ⌘+ ⌘0 and by Settings → Appearance → Text size, saved in the app's settings. Guarded by test/zoom.test.js.
import {choiceOf, defaultFactor, factorFor, factorOfChoice, step} from './zoom.js';

export function createZoom({screen, getWindow, getStorage, toWindow = () => {}}) {
  const alive = () => { const win = getWindow(); return win && !win.isDestroyed() ? win : null; };
  const width = () => { const win = alive(); const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay(); return display.workAreaSize.width; };
  const settings = () => getStorage()?.settings() || {};
  const factor = () => factorFor(settings(), width());
  const state = () => ({factor: factor(), choice: choiceOf(factor(), width()), standard: defaultFactor(width())});
  function apply() {
    const win = alive();
    if (win) win.webContents.setZoomFactor(factor());
    toWindow('zoomChanged', state());
  }
  const save = value => { getStorage()?.saveSettings({zoom: value}); apply(); return state(); };
  return {
    state, apply,
    zoomIn: () => save(step(factor(), 1)),
    zoomOut: () => save(step(factor(), -1)),
    // ⌘0: back to the screen's own default (the saved choice is dropped).
    reset: () => { getStorage()?.saveSettings({zoom: null}); apply(); return state(); },
    setChoice: choice => save(factorOfChoice(choice, width())),
    register(ipcMain) {
      ipcMain.handle('textSize', () => state());
      ipcMain.handle('setTextSize', (_, choice) => (['small', 'default', 'large'].includes(choice) ? (choice === 'default' ? this.reset() : this.setChoice(choice)) : state()));
    },
  };
}
