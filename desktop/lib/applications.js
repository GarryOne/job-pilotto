// On the Mac the app belongs in Applications: opened from the disk image (or from Downloads, where macOS runs
// a read-only copy) it can't update itself and loses its keychain access when the disk image is ejected.
// At start it offers to move itself there; Electron copies it, quits and opens the moved copy.

// Whether to ask: packaged Mac builds outside Applications only.
export function shouldOffer({platform, packaged, inApplications}) {
  return platform === 'darwin' && packaged && !inApplications;
}

export const question = {
  type: 'question',
  message: 'Move Job Pilotto to Applications?',
  detail: 'It is running from the disk image or Downloads. From Applications it can update itself and ' +
    'keeps its access to your saved keys.\n\nIt moves itself and opens again.',
  buttons: ['Move to Applications', 'Not now'],
  defaultId: 0,
  cancelId: 1,
};

// Ask, and move when the user agrees. Returns true when the app is moving (and about to quit).
// A copy already in Applications (an older version) is replaced after asking.
export function offerMove({app, dialog, platform = process.platform}) {
  // isInApplicationsFolder exists on the Mac only: asked after the platform check.
  if (!shouldOffer({platform, packaged: app.isPackaged, inApplications: platform === 'darwin' && app.isInApplicationsFolder()})) return false;
  if (dialog.showMessageBoxSync(question) !== 0) return false;
  try {
    return app.moveToApplicationsFolder({conflictHandler: kind => kind !== 'existsAndRunning' &&
      dialog.showMessageBoxSync({type: 'question', message: 'Replace the Job Pilotto in Applications?',
        detail: 'Your data is kept: it lives outside the app.', buttons: ['Replace', 'Cancel'], defaultId: 0, cancelId: 1}) === 0});
  } catch (error) {
    dialog.showMessageBoxSync({type: 'warning', message: 'Job Pilotto couldn\'t move itself',
      detail: `${error.message}\n\nDrag it from the disk image onto the Applications folder, then open it from there.`});
    return false;
  }
}
