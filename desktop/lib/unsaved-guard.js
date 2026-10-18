// Closing or reloading the main window while a page holds unsaved edits asks first (owner, 18 Oct 2026, UI redesign D2: "Warn before leaving Profile or
// closing the window with unsaved changes"): the page's save bar holds the unload (renderer/save-bar.js beforeunload), Electron then fires
// 'will-prevent-unload', and this asks Stay / Leave without saving. A hidden test window (e2e, screenshots) never waits on a dialog: it leaves.
// Guarded by test/unsaved-guard.test.js.
export const UNSAVED_DIALOG = {type: 'question', buttons: ['Stay', 'Leave without saving'], defaultId: 0, cancelId: 0,
  message: 'You have unsaved changes', detail: 'Your edits on this page are not saved yet. Leave without saving them?'};

// contents: the window's webContents; ask(options) → the pressed button's index (dialog.showMessageBoxSync bound to the window).
// app: a quit (⌘Q, an update's restart) that met the held unload was cancelled by it; after "Leave without saving" it goes on, or only the window
// closed and the app stayed with none (seen 18 Oct 2026: a screenshot run never ended).
export function guardUnsaved(contents, {ask, hidden = false, log = () => {}, app = null, later = setImmediate}) {
  let quitAsked = false;
  const asked = () => { quitAsked = true; };
  app?.on('before-quit', asked);
  contents.once?.('destroyed', () => app?.removeListener('before-quit', asked));
  contents.on('will-prevent-unload', event => {
    const leave = hidden || ask(UNSAVED_DIALOG) === 1;
    log('window', `unsaved changes on ${quitAsked ? 'quit' : 'close'}: ${leave ? 'left' : 'stayed'}`);
    if (leave) event.preventDefault();   // preventDefault here lets the unload go on
    if (leave && quitAsked) later(() => app.quit());
    quitAsked = false;   // Stay cancels the quit for good
  });
}
