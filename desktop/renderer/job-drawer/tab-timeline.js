// Drawer → Timeline (owner's board 08): what happened and when, newest first, as short entries on a line: when, an icon, the title, where it came
// from and what it said, and the way to its detail ("View message" in Messages, "View snapshot" in Application, "Open interviews"). One plain list, no filter (owner, 21 Oct 2026: messages have their own tab);
// "Add note" at its end opens the Log box on this job. The newest part of the line is
// the job's own events; the oldest entry is when the search found it. Data: renderer/job-page-view.js timelineOf. Replaces History.
import {el} from '../components.js';
import {icon} from '../icons.js';
import {timelineOf} from '../job-page-view.js';
import {openLogFor} from '../pages/jobs-lead.js';
import {button, stateCard} from './parts.js';
import {showSubmitted} from './tab-application.js';

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

export function timelineTab({job, page, parts, pick}) {
  const items = timelineOf(page?.events, job, page?.match, parts);
  const add = button('Add note', () => openLogFor(job.url, job.title), 'soft-button');
  if (!items.length) return [stateCard({icon: 'clock', title: 'Nothing has happened yet', text: 'Status changes, interviews and messages are listed here as they come.', actions: [add]})];
  const list = el('ol', 'jd-timeline');
  list.append(...items.map(item => entry(item, {job, pick})));
  const foot = el('div', 'jd-timeline-foot');
  foot.append(add);
  return [list, foot];
}
