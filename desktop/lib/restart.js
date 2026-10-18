// The one way the app restarts itself (Restart to get fixes, permission toast, reset, import, demo): exactly one new copy, started only once the quit is certain.
// Why: Electron starts one new copy per app.relaunch() at exit, so a second click during the quit guard's wait started two (probe, 18 Oct 2026), and a cancelled quit left a relaunch pending.
// Guards: test/restart.test.js (incl. "app.relaunch( appears only in this file"), test/build-handlers.test.js.
export function createRestarter({app, log = () => {}}) {
  let pending = null;
  app.on('will-quit', () => {
    if (!pending || pending.how !== 'quit') return;
    const {options} = pending;
    pending = {...pending, how: 'done'};
    app.relaunch(options);   // the quit guards have all said yes: only now is a new copy safe to schedule
  });
  return {
    // how 'quit' goes through the quit guards (before-quit); 'exit' leaves at once (reset, import, demo: nothing to ask).
    restart(reason, options, {how = 'quit'} = {}) {
      if (pending) { log(`restart: ${reason} (already under way)`); return false; }
      log(`restart: ${reason}`);
      pending = {how, options};
      if (how === 'exit') { app.relaunch(options); app.exit(0); } else app.quit();
      return true;
    },
    // The user said Cancel at the quit guard: forget the restart so a later quit is just a quit.
    cancel() { if (pending?.how === 'quit') pending = null; },
  };
}
