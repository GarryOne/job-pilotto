// Searches, Gmail checks and new-employer finds on the chosen schedule (Settings → How often) while the app is open, and catches up after the Mac wakes from sleep.
import {cadence, MAIL_HOURS} from './cadence.js';

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

// The next Gmail check (ms): the first of the chosen times of day (Settings → How often, this Mac's time
// zone) after the last check; in the past = due now. The first one runs soon after setup. null when off
// or when the cloud does it.
export function nextMailAt(settings, now = Date.now()) {
  if (!settings.setupDone || settings.cloud?.repo) return null;
  const hours = MAIL_HOURS[cadence(settings).mail];
  if (!hours) return null;
  const last = settings.lastMailAt ? Date.parse(settings.lastMailAt) : 0;
  const slots = [];
  for (let day = -1; day <= 2; day++) {
    for (const hour of hours) {
      const at = new Date(now);
      at.setDate(at.getDate() + day);
      at.setHours(hour, 0, 0, 0);
      slots.push(at.getTime());
    }
  }
  return slots.sort((a, b) => a - b).find(at => at > last);
}
export const mailDue = (settings, now = Date.now()) => { const next = nextMailAt(settings, now); return next != null && now >= next; };

// The next "Find new employers" (the scout: new job feeds for the crawl, no AI): daily or weekly after the last one
// (Settings → How often), on this Mac unless Always on runs it on GitHub. The first one after the first search.
const SCOUT_EVERY = {daily: 24, weekly: 7 * 24};
export function nextScoutAt(settings) {
  if (!settings.setupDone || settings.cloud?.repo || !settings.lastSearchAt) return null;
  const hours = SCOUT_EVERY[cadence(settings).scout];
  if (!hours) return null;
  return settings.lastScoutAt ? Date.parse(settings.lastScoutAt) + hours * 3600 * 1000 : Date.parse(settings.lastSearchAt);
}
export const scoutDue = (settings, now = Date.now()) => { const next = nextScoutAt(settings); return next != null && now >= next; };

// Every 10 minutes (and after waking): a due search, announced by soon() a minute before it starts;
// otherwise a due Gmail check (quick, so no announcement; the app notifies when it finds something).
export function startSchedule(storage, {search, mail = async () => {}, scout = async () => {}}, powerMonitor,
  {soon = () => {}, headsUp = HEADS_UP_MS, firstCheck = 30 * 1000} = {}) {
  let busy = false;
  const check = async () => {
    if (busy) return;
    busy = true;
    try {
      if (due(storage.settings())) {
        soon();
        await new Promise(resolve => setTimeout(resolve, headsUp));
        if (due(storage.settings())) await search();  // skipped if the user searched meanwhile or switched it off
      }
      if (mailDue(storage.settings())) await mail();
      if (scoutDue(storage.settings())) await scout();
    } finally { busy = false; }
  };
  const timer = setInterval(check, 10 * 60 * 1000);
  powerMonitor?.on('resume', () => setTimeout(check, 60 * 1000)); // give the network a minute after waking
  setTimeout(check, firstCheck);
  return {stop: () => clearInterval(timer)};
}

// Always on: when GitHub runs each job next, from the schedule the app wrote to the user's repo (lib/cadence.js
// crons: jobs checks at :30 from 07:30, Gmail on the hour, new employers 08:15), in this Mac's time zone.
// GitHub may start a scheduled run some minutes late. {search, mail, scout}: ms or null (off).
export function cloudNextAt(settings, now = Date.now()) {
  if (!settings.cloud?.repo) return {search: null, mail: null, scout: null};
  const {search, mail, scout} = cadence(settings);
  const next = (times, weekday = null) => {
    for (let day = 0; day <= 8; day++) {
      for (const [hour, minute] of [...times].sort((a, b) => a[0] * 60 + a[1] - b[0] * 60 - b[1])) {
        const at = new Date(now);
        at.setDate(at.getDate() + day);
        at.setHours(hour, minute, 0, 0);
        if (at.getTime() > now && (weekday == null || at.getDay() === weekday)) return at.getTime();
      }
    }
    return null;
  };
  const searchHours = search === 24 ? [7] : search > 0 ? Array.from({length: 24 / search}, (_, i) => (7 + i * search) % 24) : [];
  return {
    search: searchHours.length ? next(searchHours.map(hour => [hour, 30])) : null,
    mail: MAIL_HOURS[mail] ? next(MAIL_HOURS[mail].map(hour => [hour, 0])) : null,
    scout: scout === 'off' ? null : next([[8, 15]], scout === 'weekly' ? 1 : null),
  };
}
