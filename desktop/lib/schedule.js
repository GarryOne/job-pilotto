// Searches every 4 hours while the app is open, and catches up after the Mac wakes from sleep.
export const EVERY_HOURS = 4;

export function due(settings, now = Date.now()) {
  if (settings.autoSearch === false || !settings.setupDone) return false;
  const last = settings.lastSearchAt ? Date.parse(settings.lastSearchAt) : 0;
  return now - last >= EVERY_HOURS * 3600 * 1000;
}

export function startSchedule(storage, search, powerMonitor) {
  let busy = false;
  const check = async () => {
    if (busy || !due(storage.settings())) return;
    busy = true;
    try { await search(); } finally { busy = false; }
  };
  const timer = setInterval(check, 10 * 60 * 1000);
  powerMonitor?.on('resume', () => setTimeout(check, 60 * 1000)); // give the network a minute after waking
  setTimeout(check, 30 * 1000);
  return {stop: () => clearInterval(timer)};
}
