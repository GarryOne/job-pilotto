// The window's calls for the LibreOffice add-on (lib/office-addon.js): its state, start it again (after a failure or Cancel), cancel.
// Guard: test/ipc.test.js (every preload call has its handler), test/office-addon.test.js.
// DEMO (screenshots, the demo app): nothing is downloaded.
export function registerOfficeHandlers({ipcMain, addon, DEMO = false}) {
  ipcMain.handle('officeState', () => addon.state());
  ipcMain.handle('officeStart', () => { if (!DEMO) addon.start(); return addon.state(); });
  ipcMain.handle('officeCancel', () => { addon.cancel(); return true; });
}
