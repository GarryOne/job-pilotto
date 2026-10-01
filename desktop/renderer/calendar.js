// Calendar page: every screening and interview on one calendar. Pure (tested in test/calendar.test.js); the page is
// pages/calendar.js. Two sources, both from Notion: a job's Next interview (Applications; filled by the Gmail and Calendar
// check) and the saved recordings (🎤 Interviews: Date, Round, Application). A recording on the same day as its job's
// Next interview is the same meeting, so it is shown once, as held.
const DAY = 86400000;
const plain = id => String(id || '').replace(/-/g, '');
const page = job => plain((job.notion_url || '').split('/').pop().split('-').pop());

// 'screening' for a call at the Screening stage, or a recorded "Recruiter screen"; every other meeting is an 'interview'.
export const kindOf = (stage, round = '') => (/screen/i.test(round) || (!round && /^screening$/i.test(stage || '')) ? 'screening' : 'interview');

export const dayKey = (date, zone) => new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(date);

// → [{id, at (ms), day ('YYYY-MM-DD' in the viewer's zone), timed, kind, held, company, title, round, job}], oldest first.
export function meetings(jobs = [], recordings = [], {zone} = {}) {
  const out = [];
  const byPage = new Map(jobs.map(job => [page(job), job]).filter(([key]) => key));
  for (const job of jobs) {
    const at = Date.parse(job.next_interview || '');
    if (!Number.isFinite(at) || ['dismissed'].includes(job.status)) continue;
    const timed = String(job.next_interview).length > 10;
    out.push({id: `job:${job.url}|${job.next_interview}`, at, day: dayKey(new Date(at), zone), timed, kind: kindOf(job.stage), held: false,
      company: job.company || '', title: job.title || '', round: '', job});
  }
  for (const row of recordings) {
    const at = Date.parse(row.date || '');
    if (!Number.isFinite(at)) continue;
    const job = byPage.get(plain(row.application?.[0])) || null;
    const day = String(row.date).length > 10 ? dayKey(new Date(at), zone) : String(row.date).slice(0, 10);
    const same = out.find(m => m.job && job && m.job.url === job.url && m.day === day && !m.held);
    if (same) { Object.assign(same, {held: true, round: row.round || '', kind: kindOf(job.stage, row.round), recording: row.id}); continue; }
    out.push({id: `rec:${row.id}`, at, day, timed: String(row.date).length > 10, kind: kindOf(job?.stage, row.round), held: true, recording: row.id,
      company: job?.company || '', title: job?.title || row.title || 'Interview', round: row.round || '', job});
  }
  return out.sort((a, b) => a.at - b.at);
}

// The weeks of a month, Monday first: [[{day, inMonth, today, meetings: [...]}] × 7] × 4-6.
export function monthGrid(year, month, list = [], today = '') {
  const first = new Date(Date.UTC(year, month, 1));
  const start = first.getTime() - ((first.getUTCDay() + 6) % 7) * DAY;
  const byDay = new Map();
  for (const m of list) byDay.set(m.day, [...(byDay.get(m.day) || []), m]);
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start + (w * 7 + d) * DAY), day = date.toISOString().slice(0, 10);
      week.push({day, num: date.getUTCDate(), inMonth: date.getUTCMonth() === month, today: day === today, meetings: byDay.get(day) || []});
    }
    if (w >= 4 && !week.some(cell => cell.inMonth)) break;
    weeks.push(week);
  }
  return weeks;
}

// The agenda beside the grid: what is coming (soonest first), then what was held or has passed (latest first).
export function agenda(list = [], now = Date.now(), zone) {
  const today = dayKey(new Date(now), zone);
  return {
    upcoming: list.filter(m => m.day >= today && !(m.held && m.day === today && m.at < now)),
    past: list.filter(m => m.day < today || (m.held && m.day === today && m.at < now)).reverse(),
    today,
  };
}
