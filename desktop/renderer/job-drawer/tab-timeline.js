// Drawer → Timeline (owner's board 08): what happened and when, newest first, as short entries on a line: when, an icon, the title, where it came
// from and what it said, and the way to its detail ("View message" in Messages, "View snapshot" in Application, "Open interviews"). A filter
// (All / Applications / Messages / Interviews) with counts, kept per job; "Add note" opens the Log box on this job. The newest part of the line is
// the job's own events; the oldest entry is when the search found it. Data: renderer/job-page-view.js timelineOf. Replaces History.
import {el} from '../components.js';
import {icon} from '../icons.js';
import {timelineOf} from '../job-page-view.js';
import {openLogFor} from '../pages/jobs-lead.js';
import {button, choice, stateCard} from './parts.js';
import {showSubmitted} from './tab-application.js';

const chosen = new Map();   // job url → 'all' | 'application' | 'message' | 'interview'
const ICONS = {'Job discovered': 'search', Applied: 'file', 'Confirmation received': 'check-circle', 'Interview scheduled': 'calendar', Rejected: 'close', Offer: 'check-circle'};
const LINKS = {messages: ['View message →', 'messages'], interviews: ['Open interviews →', 'interviews'], snapshot: ['View snapshot →', 'application']};

function entry(item, {job, pick}) {
  const row = el('li', 'jd-event');
  const when = el('div', 'jd-event-when');
  when.append(el('b', '', item.when || ''), ...(item.time ? [el('span', 'muted small', item.time)] : []));
  const mark = el('span', 'jd-event-icon');
  mark.append(icon(ICONS[item.kind] || (item.kinds.includes('message') ? 'mail' : 'clock')));
  const words = el('div', 'jd-event-words');
  words.append(el('b', '', item.title), ...(item.source ? [el('span', 'muted small', item.source)] : []), ...(item.text ? [el('span', '', item.text)] : []));
  row.append(when, mark, words);
  if (item.link) {
    const [label, tab] = LINKS[item.link];
    row.append(button(label, () => { if (item.link === 'snapshot') showSubmitted(job.url); pick(tab); }, 'soft-button'));
  }
  return row;
}

export function timelineTab({job, page, parts, pick}, redraw) {
  const items = timelineOf(page?.events, job, page?.match, parts);
  const add = button('Add note', () => openLogFor(job.url, job.title), 'soft-button');
  if (!items.length) return [stateCard({icon: 'clock', title: 'Nothing has happened yet', text: 'Status changes, interviews and messages are listed here as they come.', actions: [add]})];
  const count = kind => items.filter(item => item.kinds.includes(kind)).length;
  const active = chosen.get(job.url) || 'all';
  const options = [['all', `All ${items.length}`], ['application', `Applications ${count('application')}`], ['message', `Messages ${count('message')}`], ['interview', `Interviews ${count('interview')}`]];
  const row = el('div', 'jd-filter');
  row.append(choice(options, active, key => { chosen.set(job.url, key); redraw(); }, 'Timeline'), add);
  const shown = items.filter(item => active === 'all' || item.kinds.includes(active));
  if (!shown.length) return [row, stateCard({icon: 'search', title: 'Nothing here yet', text: 'Choose All to see everything that happened on this job.'})];
  const list = el('ol', 'jd-timeline');
  list.append(...shown.map(item => entry(item, {job, pick})));
  return [row, list];
}
