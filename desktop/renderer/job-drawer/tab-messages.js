// Drawer → Messages: what we communicated: the recruiter's message and the logged ones (full text), and a logged message's screenshots as the
// composer's attachment rows. None: a state card.
import {el} from '../components.js';
import {group, stateCard} from './parts.js';

// The job's screenshots (lib/store/files.js): View shows one at full width in the drawer.
function shotsView(shots) {
  if (!shots.length) return [];
  return [group('Screenshots', shots.map(shot => {
    const row = el('div', 'attachment');
    const view = Object.assign(el('button', 'soft-button', shot.url ? 'View' : 'Too large to show'), {type: 'button', disabled: !shot.url});
    view.addEventListener('click', () => {
      const open = row.nextElementSibling?.classList.contains('job-panel-shot');
      if (open) { row.nextElementSibling.remove(); view.textContent = 'View'; return; }
      row.after(Object.assign(el('img', 'job-panel-shot'), {src: shot.url, alt: shot.name}));
      view.textContent = 'Hide';
    });
    row.append(...(shot.url ? [Object.assign(el('img'), {src: shot.url, alt: ''})] : []), el('span', 'attachment-name', shot.name), view);
    return row;
  }))];
}

export function messagesTab({parts}) {
  if (!parts.has.messages) return [stateCard({icon: 'mail', title: 'No linked messages yet', text: 'Replies from the employer and the messages you log about this job show here.'})];
  return [...parts.groups.messages.map(part => group(part.title, part.lines)), ...shotsView(parts.shots)];
}
