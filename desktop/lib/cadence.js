// How often each job runs, chosen by the user (Settings → How often), as GitHub Actions schedules.
// Times are picked in the user's own time zone; GitHub schedules are UTC, so they're converted here
// (a daylight-saving change shifts them by an hour until the next update).
// scout is off for new installs: one central scout finds employers for everyone and the app downloads its index
// (src/employer_index.py). Installs set up before that keep their daily scout (migrate.js → pinScoutSchedule).
export const DEFAULTS = {search: 4, kits: 0, insights: 'daily', scout: 'off', mail: 3};
export const CHOICES = {
  search: [1, 2, 3, 4, 6, 8, 12, 24, 0],   // hours between searches; 0 = off
  kits: [0, 1, 3, 5],                      // application kits drafted per search for the best new matches
  insights: ['daily', 'off'],              // morning insight (and the Monday weekly report)
  scout: ['daily', 'weekly', 'off'],
  mail: [1, 3, 6, 0],                       // times a day; 0 = off
};
export const MAIL_HOURS = {1: [8], 3: [7, 12, 18], 6: [7, 10, 13, 16, 19, 22]};

export function cadence(settings = {}) {
  return {...DEFAULTS, ...(settings.schedule || {})};
}

// A local hour:minute as a UTC cron minute and hour, for this Mac's current offset from UTC.
function utc(hour, minute, offsetMinutes) {
  const total = ((hour * 60 + minute - offsetMinutes) % 1440 + 1440) % 1440;
  return {minute: total % 60, hour: Math.floor(total / 60)};
}

// {daily.yml: cron or null (off), scout.yml: …, mail.yml: …}
export function crons(settings, offsetMinutes = -new Date().getTimezoneOffset()) {
  const {search, scout, mail} = cadence(settings);
  const at = (hours, minute) => {
    const times = hours.map(hour => utc(hour, minute, offsetMinutes));
    const minutes = [...new Set(times.map(t => t.minute))];
    if (minutes.length === 1) return `${minutes[0]} ${times.map(t => t.hour).sort((a, b) => a - b).join(',')} * * *`;
    return `${times[0].minute} ${times[0].hour} * * *`;  // offsets like +05:45: keep the first time only
  };
  let daily = null;
  if (search === 24) daily = at([7], 30);
  else if (search > 0) daily = at(Array.from({length: 24 / search}, (_, i) => (7 + i * search) % 24), 30);
  const firstScout = utc(8, 15, offsetMinutes);
  return {
    'daily.yml': daily,
    'scout.yml': scout === 'off' ? null : `${firstScout.minute} ${firstScout.hour} * * ${scout === 'weekly' ? '1' : '*'}`,
    'mail.yml': mail > 0 ? at(MAIL_HOURS[mail], 0) : null,
  };
}

// The template's schedule set to `cron`, or removed (manual and bot-started runs still work).
export function withSchedule(yaml, cron) {
  yaml = yaml.replace(/\r\n/g, '\n');  // a Windows checkout may have given the template CRLF endings
  const block = /  schedule:\n    - cron: '[^']*'\n/;
  const schedule = cron ? `  schedule:\n    - cron: '${cron}'\n` : '';
  if (block.test(yaml)) return yaml.replace(block, schedule);
  // Templates ship without one: add it after the "on:" line (and its comment).
  return yaml.replace(/^on:\n(  #[^\n]*\n)?/m, match => match + schedule);
}
