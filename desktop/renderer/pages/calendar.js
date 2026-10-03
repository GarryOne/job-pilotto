// Calendar page: screenings and interviews on a month grid, with the agenda beside it (renderer/calendar.js). From the job
// list (Next interview) and the saved recordings (Notion 🎤 Interviews); clicking a meeting opens its job in Notion.
import {el, pill} from '../components.js';
import * as cal from '../calendar.js';
import {shared} from './shared.js';
import {$, savedAgo} from './core.js';
import {dismissInterview} from './happened.js';

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const KINDS = {screening: ['Screening', 'teal'], interview: ['Interview', 'info']};
let month = null;        // {year, month} shown
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
  const button = el('button', `cal-chip kind-${m.kind}${m.held ? ' held' : ''}`, `${m.held ? '✓ ' : ''}${timeOf(m)} ${name(m)}`.trim());
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
  line.append(el('span', 'cal-when', `${dayLabel(m)}${timeOf(m) ? ` · ${timeOf(m)}` : ''}`),
    el('b', 'cal-who', name(m)), el('span', 'muted small', [m.title !== name(m) ? m.title : '', m.round].filter(Boolean).join(' · ')),
    pill(KINDS[m.kind][0], KINDS[m.kind][1]));
  line.onclick = () => open(m);
  const x = cross(m);
  if (!x) return line;
  const wrap = el('div', 'cal-row-wrap');
  wrap.append(line, x);
  return wrap;
}

const skeletons = () => [0, 1, 2].map(() => { const box = el('div', 'cal-row'); box.append(el('span', 'skeleton w-40'), el('span', 'skeleton w-80')); return box; });

function status() {
  const text = phase === 'loading' ? 'Reading your meetings from Notion…'
    : phase === 'updating' ? `${savedAt ? `Saved ${savedAt} · ` : ''}updating from Notion…`
    : phase === 'failed' ? `Couldn't refresh from Notion${savedAt ? ` · showing the copy saved ${savedAt}` : ''}. ${failure}`.trim() : '';
  const node = $('cal-status');
  node.textContent = text;
  node.className = `muted small cal-status${phase === 'failed' ? ' bad' : ''}`;
  node.hidden = !text;
}

export function render() {
  status();
  const jobs = Array.isArray(shared.allJobs) ? shared.allJobs : [];
  const list = visible(cal.meetings(jobs, recordings, {zone: ZONE}));
  const today = cal.dayKey(new Date(), ZONE);
  $('cal-title').textContent = monthName(month);
  const weeks = cal.monthGrid(month.year, month.month, list, today);
  const head = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => el('span', 'cal-dow', day));
  const cells = weeks.flat().map(cell => {
    const node = el('div', `cal-cell${cell.inMonth ? '' : ' out'}${cell.today ? ' today' : ''}`);
    node.append(el('span', 'cal-num', cell.num), ...cell.meetings.slice(0, 3).map(chip));
    if (cell.meetings.length > 3) node.append(el('span', 'muted small', `+${cell.meetings.length - 3} more`));
    return node;
  });
  $('cal-grid').replaceChildren(...head, ...cells);
  const {upcoming, past} = cal.agenda(list, Date.now(), ZONE);
  if (phase === 'loading') { $('cal-upcoming').replaceChildren(...skeletons()); $('cal-past').replaceChildren(...skeletons()); return; }
  $('cal-upcoming').replaceChildren(...(upcoming.length ? upcoming.map(row) : [el('p', 'muted small', 'Nothing scheduled. A call booked by email shows up here after the next Gmail check.')]));
  $('cal-past').replaceChildren(...(past.length ? past.slice(0, 20).map(row) : [el('p', 'muted small', 'No past meetings yet.')]));
}

// A month with nothing in it, and a meeting coming later: open on that one (until the user picks a month themselves).
function openOnNext() {
  if (moved) return;
  const list = visible(cal.meetings(Array.isArray(shared.allJobs) ? shared.allJobs : [], recordings, {zone: ZONE}));
  const inMonth = list.some(m => m.day.startsWith(`${month.year}-${String(month.month + 1).padStart(2, '0')}`));
  const next = cal.agenda(list, Date.now(), ZONE).upcoming[0];
  if (!inMonth && next) month = {year: Number(next.day.slice(0, 4)), month: Number(next.day.slice(5, 7)) - 1};
}

// Cache first: the last jobs and recordings read (kept on this Mac by main.js) paint at once, then Notion is read and the
// page swaps in the fresh copy. A failed read keeps what is shown and says so; it never turns into an empty calendar.
export async function loadCalendar() {
  if (!month) { const now = new Date(); month = {year: now.getFullYear(), month: now.getMonth()}; }
  const mine = ++visit;
  const [cachedJobs, cachedRecordings] = await Promise.all([
    jobsLoaded() ? null : window.pilot.cached('jobs').catch(() => null), window.pilot.cached('interviews').catch(() => null)]);
  if (mine !== visit) return;
  if (cachedJobs?.result?.jobs?.length && !jobsLoaded()) shared.allJobs = cachedJobs.result.jobs;
  if (cachedRecordings?.result?.interviews) recordings = cachedRecordings.result.interviews;
  savedAt = cachedRecordings?.at || cachedJobs?.at ? savedAgo(cachedRecordings?.at || cachedJobs?.at) : '';
  phase = jobsLoaded() || cachedRecordings ? 'updating' : 'loading';
  openOnNext();
  render();
  const [fresh, saved] = await Promise.all([
    window.pilot.jobs().catch(() => null), window.pilot.interviews.saved().catch(() => null)]);
  if (mine !== visit) return;
  if (Array.isArray(fresh?.jobs) && !fresh.stale) shared.allJobs = fresh.jobs;
  if (Array.isArray(saved?.interviews)) recordings = saved.interviews;
  const ok = Array.isArray(fresh?.jobs) && !fresh.stale && Array.isArray(saved?.interviews);
  failure = ok ? '' : String(saved?.error || fresh?.error || 'Try again in a moment; the reason is in the app log.');
  phase = ok ? 'ready' : 'failed';
  if (ok) { const still = new Set(cal.meetings(shared.allJobs, recordings, {zone: ZONE}).map(m => m.id)); for (const id of [...gone.keys()]) if (!still.has(id)) gone.delete(id); }
  if (ok) savedAt = '';
  openOnNext();
  render();
}

const step = by => { moved = true; const d = new Date(Date.UTC(month.year, month.month + by, 1)); month = {year: d.getUTCFullYear(), month: d.getUTCMonth()}; render(); };

export async function init() {
  $('cal-prev').onclick = () => step(-1);
  $('cal-next').onclick = () => step(1);
  // Today only moves the grid, as Prev/Next do: it used to re-read the whole calendar from Notion (about 1 s with no sign of work, #67).
  $('cal-today').onclick = () => { const now = new Date(); moved = true; month = {year: now.getFullYear(), month: now.getMonth()}; render(); };
}
