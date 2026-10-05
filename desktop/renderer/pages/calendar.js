// Calendar page: screenings and interviews on a month grid, with the agenda beside it (renderer/calendar.js). From the job
// list (Next interview) and the saved recordings (Notion 🎤 Interviews); clicking a meeting opens its job in Notion.
import {el} from '../components.js';
import {icon} from '../icons.js';
import * as cal from '../calendar.js';
import {shared} from './shared.js';
import {$, savedAgo} from './core.js';
import {dismissInterview} from './happened.js';
import {openView} from './nav.js';

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const KINDS = {screening: ['Screening', 'teal'], interview: ['Interview', 'info']};
let month = null;        // {year, month} shown
let pastShown = 20;      // how many past meetings the Recent list shows (Load more adds 20)
let calJobs = [];        // the jobs the meetings come from (the Calendar's own small read; the full list only while it is the one at hand)
let recordings = [];     // saved interview rows
// What is on screen: 'loading' (nothing to show yet), 'updating' (a saved copy shown while Notion is read), 'ready', 'failed'.
let phase = 'loading', savedAt = '', failure = '';
let visit = 0, moved = false;   // moved: the user picked a month, so a reload never jumps           // a newer visit makes an older read's answer stale
// A meeting you just dismissed stays off the calendar until a read of Notion no longer has it (a read already under way,
// or Notion's own delay, would otherwise bring it back for a few seconds); never longer than a minute.
const gone = new Map();   // meeting id → until (ms)
const visible = list => list.filter(m => !(gone.get(m.id) > Date.now()));
const jobsLoaded = () => Array.isArray(shared.allJobs) && shared.allJobs.length > 0;

const monthName = ({year, month: m}) => new Date(Date.UTC(year, m, 1)).toLocaleDateString(undefined, {month: 'long', year: 'numeric', timeZone: 'UTC'});
const timeOf = m => (m.timed ? new Date(m.at).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', timeZone: ZONE}) : '');
const dayLabel = m => new Date(`${m.day}T12:00:00Z`).toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'});
const name = m => m.company || m.title || 'Interview';

function open(m) {
  const url = m.job?.notion_url;
  if (url) window.pilot.openExternal(url);
}

// The small ✕ on a meeting that hasn't been held: give up on it (confirmation first). It leaves the calendar at once.
function cross(m) {
  if (m.held || !m.job || !cal.page(m.job)) return null;
  const button = Object.assign(el('button', 'cal-cross', '×'), {type: 'button', title: 'Dismiss this interview'});
  button.setAttribute('aria-label', `Dismiss the ${name(m)} interview`);
  button.onclick = event => {
    event.stopPropagation();
    const before = m.job.next_interview;
    dismissInterview({page_id: cal.page(m.job), company: m.company}, {
      onConfirmed: () => { gone.set(m.id, Date.now() + 60000); m.job.next_interview = ''; render(); },
      onFail: () => { gone.delete(m.id); m.job.next_interview = before; render(); },
      onDone: () => loadCalendar()});
  };
  return button;
}

function chip(m) {
  const button = el('button', `cal-chip kind-${m.kind}${m.held ? ' held' : ''}`);
  const when = `${m.held ? '✓ ' : ''}${timeOf(m)}`.trim();
  if (when) button.append(el('span', 'cal-chip-time', when));
  button.append(el('span', 'cal-chip-name', name(m)));
  button.title = `${KINDS[m.kind][0]}${m.round ? ` · ${m.round}` : ''} · ${name(m)}${m.held ? ' (held)' : ''}`;
  button.onclick = () => open(m);
  const x = cross(m);
  if (!x) return button;
  const wrap = el('span', 'cal-chip-wrap');
  wrap.append(button, x);
  return wrap;
}

function row(m) {
  const line = el('button', 'cal-row');
  const job = m.title !== name(m) ? m.title : '';
  line.append(el('b', 'cal-who', name(m)), el('span', 'cal-when', `${dayLabel(m)}${timeOf(m) ? ` · ${timeOf(m)}` : ''}`),
    ...(job ? [el('span', 'cal-job', job)] : []), el('span', `cal-stage kind-${m.kind}`, m.round || KINDS[m.kind][0]));
  line.onclick = () => open(m);
  const x = cross(m);
  if (!x) return line;
  const wrap = el('div', 'cal-row-wrap');
  wrap.append(line, x);
  return wrap;
}

function emptyUpcoming() {
  const box = el('div', 'cal-empty');
  box.append(icon('calendar'), el('b', '', 'No upcoming interviews'), el('span', 'muted small', 'Email bookings appear after the next Gmail check.'));
  return box;
}
const skeletons = () => [0, 1, 2].map(() => { const box = el('div', 'cal-row'); box.append(el('span', 'skeleton w-40'), el('span', 'skeleton w-80')); return box; });

function status() {
  const text = phase === 'loading' ? 'Reading from Notion…'
    : phase === 'updating' ? 'Updating from Notion…'
    : phase === 'failed' ? `Couldn't refresh from Notion${savedAt ? ` · showing the copy saved ${savedAt}` : ''}. ${failure}`.trim() : '';
  const node = $('cal-status');
  node.replaceChildren(...(phase === 'failed' || !text ? [] : [el('span', 'spinner')]), text);
  node.className = `muted small cal-status${phase === 'failed' ? ' bad' : ''}`;
  node.title = text;
  node.hidden = !text;
}

export function render() {
  status();
  const list = visible(cal.meetings(calJobs, recordings, {zone: ZONE}));
  const today = cal.dayKey(new Date(), ZONE);
  // Today greys out while the grid already shows this month: pressed there it rightly did nothing, which read as a broken button (#83).
  const now = new Date();
  $('cal-today').disabled = month.year === now.getFullYear() && month.month === now.getMonth();
  $('cal-title').textContent = monthName(month);
  const weeks = cal.monthGrid(month.year, month.month, list, today);
  const head = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => el('span', 'cal-dow', day));
  const cells = weeks.flat().map((cell, i) => {
    const node = el('div', `cal-cell${cell.inMonth ? '' : ' out'}${cell.today ? ' today' : ''}${i % 7 > 4 ? ' weekend' : ''}`);
    node.append(el('span', 'cal-num', cell.num), ...cell.meetings.slice(0, 3).map(chip));
    if (cell.meetings.length > 3) node.append(el('span', 'muted small', `+${cell.meetings.length - 3} more`));
    return node;
  });
  $('cal-grid').replaceChildren(...head, ...cells);
  const {upcoming, past} = cal.agenda(list, Date.now(), ZONE);
  if (phase === 'loading') { $('cal-upcoming').replaceChildren(...skeletons()); $('cal-past').replaceChildren(...skeletons()); return; }
  $('cal-upcoming').replaceChildren(...(upcoming.length ? upcoming.map(row) : [emptyUpcoming()]));
  $('cal-past').replaceChildren(...(past.length ? past.slice(0, pastShown).map(row) : [el('p', 'muted small', 'No past meetings yet.')]));
  $('cal-past-count').textContent = past.length || '';
  $('cal-past-count').hidden = !past.length;
  $('cal-past-foot').hidden = past.length <= 20;
  $('cal-past-shown').textContent = `Showing ${Math.min(pastShown, past.length)} of ${past.length}`;
  $('cal-past-more').hidden = pastShown >= past.length;
}

// A month with nothing in it, and a meeting coming later: open on that one (until the user picks a month themselves).
function openOnNext() {
  if (moved) return;
  const list = visible(cal.meetings(calJobs, recordings, {zone: ZONE}));
  const inMonth = list.some(m => m.day.startsWith(`${month.year}-${String(month.month + 1).padStart(2, '0')}`));
  const next = cal.agenda(list, Date.now(), ZONE).upcoming[0];
  if (!inMonth && next) month = {year: Number(next.day.slice(0, 4)), month: Number(next.day.slice(5, 7)) - 1};
}

// Cache first: the last jobs and recordings read (kept on this Mac by main.js) paint at once, then Notion is read and the
// page swaps in the fresh copy. A failed read keeps what is shown and says so; it never turns into an empty calendar.
// Two small reads, each painting as it arrives: the Applications rows (the only jobs with a Next interview; the full Jobs
// list took ~10 s because it also reads every job a search found) and the saved recordings (~4 s).
export async function loadCalendar() {
  if (!month) { const now = new Date(); month = {year: now.getFullYear(), month: now.getMonth()}; }
  const mine = ++visit;
  const [cachedJobs, cachedRecordings] = await Promise.all([
    window.pilot.cached('calendar').catch(() => null), window.pilot.cached('calendarRecordings').catch(() => null)]);
  if (mine !== visit) return;
  if (cachedJobs?.result?.jobs?.length) calJobs = cachedJobs.result.jobs;
  else if (jobsLoaded()) calJobs = shared.allJobs;
  if (cachedRecordings?.result?.interviews) recordings = cachedRecordings.result.interviews;
  savedAt = cachedRecordings?.at || cachedJobs?.at ? savedAgo(cachedRecordings?.at || cachedJobs?.at) : '';
  phase = calJobs.length || cachedRecordings ? 'updating' : 'loading';
  openOnNext();
  render();
  let jobsOk = false, recordingsOk = false, error = '';
  const finish = () => {
    if (mine !== visit) return;
    if (jobsOk && recordingsOk) {
      phase = 'ready'; failure = ''; savedAt = '';
      const still = new Set(cal.meetings(calJobs, recordings, {zone: ZONE}).map(m => m.id)); for (const id of [...gone.keys()]) if (!still.has(id)) gone.delete(id);
    } else if (jobsOk === null || recordingsOk === null) { phase = 'failed'; failure = error || 'Try again in a moment; the reason is in the app log.'; }
    else phase = 'updating';
    openOnNext();
    render();
  };
  window.pilot.calendarJobs().then(fresh => {
    if (Array.isArray(fresh?.jobs) && !fresh.error) { calJobs = fresh.jobs; jobsOk = true; } else { jobsOk = null; error ||= String(fresh?.error || ''); }
  }, () => { jobsOk = null; }).then(finish);
  window.pilot.calendarRecordings().then(saved => {
    if (Array.isArray(saved?.interviews)) { recordings = saved.interviews; recordingsOk = true; } else { recordingsOk = null; error ||= String(saved?.error || ''); }
  }, () => { recordingsOk = null; }).then(finish);
}

const step = by => { moved = true; const d = new Date(Date.UTC(month.year, month.month + by, 1)); month = {year: d.getUTCFullYear(), month: d.getUTCMonth()}; render(); };

export async function init() {
  $('cal-more-view').onclick = () => openView('interviews');
  $('cal-past-more').onclick = () => { pastShown += 20; render(); };
  $('cal-prev').onclick = () => step(-1);
  $('cal-next').onclick = () => step(1);
  // Today only moves the grid, as Prev/Next do: it used to re-read the whole calendar from Notion (about 1 s with no sign of work, #67).
  $('cal-today').onclick = () => { const now = new Date(); moved = true; month = {year: now.getFullYear(), month: now.getMonth()}; render(); };
}
