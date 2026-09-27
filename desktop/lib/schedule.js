// Searches on the chosen schedule (Settings → How often) while the app is open, and catches up after the Mac wakes from sleep.
import {cadence} from './cadence.js';

export const EVERY_HOURS = 4;  // default; the user picks it in Settings → How often

export function due(settings, now = Date.now()) {
  if (settings.autoSearch === false || !settings.setupDone || settings.cloud?.repo) return false; // cloud runs instead
  const last = settings.lastSearchAt ? Date.parse(settings.lastSearchAt) : 0;
  const hours = cadence(settings).search;
  if (!hours) return false;  // searches only when asked
  return now - last >= hours * 3600 * 1000;
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
