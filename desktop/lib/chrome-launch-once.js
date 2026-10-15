// One Chrome launch at a time: after the app opens Chrome for the extension, further presses wait until the extension reports or START_MS pass.
// Guarded by test/app-scenarios.test.js (5 presses = 1 launch).
export const START_MS = 30 * 1000;
export function launchOnce(launch, extensionSeenAt, now = Date.now) {
  let startedAt = 0;
  return async () => {
    const t = now();
    // Still starting: the extension has not reported since the launch and START_MS have not passed.
    if (startedAt && t - startedAt < START_MS && !(extensionSeenAt() >= startedAt)) return {opened: true, starting: true, since: startedAt};
    startedAt = t;
    const opened = await launch();
    if (!opened) startedAt = 0;   // nothing started: the next press may try again
    return {opened, starting: !!opened, since: startedAt};
  };
}
