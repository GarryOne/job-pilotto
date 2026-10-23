// Main process: reports a crash or a stray rejection to technical reports without changing what Electron does with it. Moved out of main.js; no window needed.
export function installCrashMonitors({getTelemetry}) {
  const record = (type, error) => getTelemetry()?.record('crash', {where: 'main', type, message: error?.message || String(error), stack: error?.stack});
  // Electron's desktopCapturer rejects an internal promise ("Failed to get sources") when macOS hasn't allowed
  // screen capture, even though the display-media handler catches it; that one is expected (the recorder shows
  // the permission panel), so it isn't logged. Every other unhandled rejection still is.
  process.on('unhandledRejection', reason => {
    if (String(reason?.message || reason) === 'Failed to get sources.') return;
    console.error('Unhandled rejection:', reason);
    record(reason?.name || 'Rejection', reason);
  });
  // A crash in the main process, reported without changing what Electron does with it (the monitor only watches).
  process.on('uncaughtExceptionMonitor', error => record(error?.name || 'Error', error));
}
