// The time this computer has been awake: Date.now() minus the time it slept. Watchdogs measure with it, so a Mac asleep with its lid
// closed is not a run gone quiet (7 Oct 2026: a scheduled refresh was stopped twice for "no output for 15 min", each time the moment the
// Mac woke up). Fed by Electron's powerMonitor (suspend / resume); without it (tests, a CLI) it is Date.now().
let slept = 0, suspendedAt = null;

export function watchSleep(powerMonitor, log = () => {}, now = () => Date.now()) {
  powerMonitor?.on('suspend', () => { suspendedAt = now(); });
  powerMonitor?.on('resume', () => {
    if (suspendedAt == null) return;
    const ms = Math.max(0, now() - suspendedAt);
    slept += ms;
    suspendedAt = null;
    log('run', 'the computer slept: watchdogs do not count it', {slept_s: Math.round(ms / 1000)});
  });
}

// Milliseconds the computer has slept since the app started (while asleep, the sleep so far).
export const sleptMs = (now = Date.now()) => slept + (suspendedAt == null ? 0 : Math.max(0, now - suspendedAt));
export const awakeNow = (now = Date.now()) => now - sleptMs(now);
export function resetSleepForTests() { slept = 0; suspendedAt = null; }
