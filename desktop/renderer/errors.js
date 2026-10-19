// The plain line for an error from the app behind the window: a window newer than the running app gets "Restart it" and a Restart button, never the raw IPC text.
// Guards: test/outdated-error.test.js (preload turns "No handler registered" into OUTDATED_LINE for every action; the Ready card shows line + Restart).
export const OUTDATED_LINE = 'Jobadabra was updated while it was open. Restart it to use this.';   // same words as preload.cjs
export const isOutdated = error => String(error?.message || error) === OUTDATED_LINE || /No handler registered/.test(String(error?.message || error));
export const relaunch = () => window.pilot.interviews.relaunch();   // the app's one shared restart path (lib/restart.js)
export function restartButton() {
  const button = Object.assign(document.createElement('button'), {className: 'secondary', textContent: 'Restart'});
  button.addEventListener('click', () => { button.disabled = true; relaunch(); });
  return button;
}
// The words to show for a failed call: the restart line when the app is older than the window, else the error as plain text (no IPC wrapper) or the screen's own wording.
export const errorLine = (error, fallback = 'Something went wrong. Try again.') =>
  isOutdated(error) ? OUTDATED_LINE : String(error?.message || error || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || fallback;
