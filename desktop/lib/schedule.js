// Searches on the chosen schedule (Settings → How often) while the app is open, and catches up after the Mac wakes from sleep.
import {cadence} from './cadence.js';

export const EVERY_HOURS = 4;  // default; the user picks it in Settings → How often

export const HEADS_UP_MS = 60 * 1000;  // "starts in a minute" notice before a scheduled search

// When the next scheduled search is due (ms), or null when none is scheduled on this Mac.
export function nextAt(settings) {
  if (settings.autoSearch === false || !settings.setupDone || settings.cloud?.repo) return null; // cloud runs instead
  if (!settings.lastSearchAt) return null;  // the first search starts when setup finishes, on screen
  const hours = cadence(settings).search;
  if (!hours) return null;  // searches only when asked
  return Date.parse(settings.lastSearchAt) + hours * 3600 * 1000;
}

export function due(settings, now = Date.now()) {
  const next = nextAt(settings);
  return next != null && now >= next;
}

// soon() is called a minute before a scheduled search starts (for the "starting soon" notification).
export function startSchedule(storage, search, powerMonitor, {soon = () => {}, headsUp = HEADS_UP_MS, firstCheck = 30 * 1000} = {}) {
  let busy = false;
  const check = async () => {
    if (busy || !due(storage.settings())) return;
    busy = true;
    try {
      soon();
      await new Promise(resolve => setTimeout(resolve, headsUp));
      if (due(storage.settings())) await search();  // skipped if the user searched meanwhile or switched it off
    } finally { busy = false; }
  };
  const timer = setInterval(check, 10 * 60 * 1000);
  powerMonitor?.on('resume', () => setTimeout(check, 60 * 1000)); // give the network a minute after waking
  setTimeout(check, firstCheck);
  return {stop: () => clearInterval(timer)};
}
