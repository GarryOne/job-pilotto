// Calendar page: screenings and interviews on a month grid, with the agenda beside it (renderer/calendar.js). From the job
// list (Next interview) and the saved recordings (Notion 🎤 Interviews); clicking a meeting opens its job in Notion.
import {el, pill} from '../components.js';
import * as cal from '../calendar.js';
import {shared} from './shared.js';
import {$} from './core.js';

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const KINDS = {screening: ['Screening', 'teal'], interview: ['Interview', 'info']};
let month = null;        // {year, month} shown
let recordings = [];     // saved interview rows, read once per visit

const monthName = ({year, month: m}) => new Date(Date.UTC(year, m, 1)).toLocaleDateString(undefined, {month: 'long', year: 'numeric', timeZone: 'UTC'});
const timeOf = m => (m.timed ? new Date(m.at).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', timeZone: ZONE}) : '');
const dayLabel = m => new Date(`${m.day}T12:00:00Z`).toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'});
const name = m => m.company || m.title;

function open(m) {
  const url = m.job?.notion_url;
  if (url) window.pilot.openExternal(url);
}

function chip(m) {
  const button = el('button', `cal-chip kind-${m.kind}${m.held ? ' held' : ''}`, `${m.held ? '✓ ' : ''}${timeOf(m)} ${name(m)}`.trim());
  button.title = `${KINDS[m.kind][0]}${m.round ? ` · ${m.round}` : ''} · ${name(m)}${m.held ? ' (held)' : ''}`;
  button.onclick = () => open(m);
  return button;
}

function row(m) {
  const line = el('button', 'cal-row');
  line.append(el('span', 'cal-when', `${dayLabel(m)}${timeOf(m) ? ` · ${timeOf(m)}` : ''}`),
    el('b', 'cal-who', name(m)), el('span', 'muted small', [m.title !== name(m) ? m.title : '', m.round].filter(Boolean).join(' · ')),
    pill(KINDS[m.kind][0], KINDS[m.kind][1]));
  line.onclick = () => open(m);
  return line;
}

export function render() {
  const jobs = Array.isArray(shared.allJobs) ? shared.allJobs : [];
  const list = cal.meetings(jobs, recordings, {zone: ZONE});
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
  $('cal-upcoming').replaceChildren(...(upcoming.length ? upcoming.map(row) : [el('p', 'muted small', 'Nothing scheduled. A call booked by email shows up here after the next Gmail check.')]));
  $('cal-past').replaceChildren(...(past.length ? past.slice(0, 20).map(row) : [el('p', 'muted small', 'No past meetings yet.')]));
}

export async function loadCalendar() {
  if (!month) { const now = new Date(); month = {year: now.getFullYear(), month: now.getMonth()}; }
  render();
  const saved = await window.pilot.interviews.saved().catch(() => null);
  if (Array.isArray(saved?.interviews)) { recordings = saved.interviews; render(); }
}

const step = by => { const d = new Date(Date.UTC(month.year, month.month + by, 1)); month = {year: d.getUTCFullYear(), month: d.getUTCMonth()}; render(); };

export async function init() {
  $('cal-prev').onclick = () => step(-1);
  $('cal-next').onclick = () => step(1);
  $('cal-today').onclick = () => { month = null; loadCalendar(); };
}
