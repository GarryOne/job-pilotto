// Drawer → Timeline: what happened and when, newest first (the job's events: applied, interview, rejection...). Replaces History.
// None yet: a state card.
import {el} from '../components.js';
import {group, stateCard} from './parts.js';

export function timelineTab({parts}) {
  if (!parts.history.length) return [stateCard({icon: 'clock', title: 'Nothing has happened yet', text: 'Status changes, interviews and messages are listed here as they come.'})];
  return [group('', parts.history.map(item => {
    const row = el('div', 'iv-moment');
    row.append(el('b', '', `${item.when} · ${item.kind}`), ...(item.note ? [el('span', 'muted', item.note)] : []));
    return row;
  }))];
}
