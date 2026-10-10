// Drawer → Messages (owner's board 07): all linked communication about the job, newest email first, then what you logged. A filter with counts
// (All / Email / Notes) kept per job; each email a card that folds (from, what it said, "Open in Gmail"); Gmail not connected says so with
// the way to connect it (existing messages still show); "Add note" opens the Log box on this job. Screenshots of a logged message are listed
// below. Words and data: renderer/job-page-view.js messagesOf, gmailUrl.
import {el} from '../components.js';
import {messagesOf} from '../job-page-view.js';
import {gmailConnected} from '../pages/activity-basics.js';
import {openLogFor} from '../pages/jobs-lead.js';
import {openSetting} from '../pages/settings.js';
import {button, choice, foldCard, group, lineView, stateCard} from './parts.js';

const chosen = new Map();   // job url → 'all' | 'email' | 'note'

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

function emailCard(email, first) {
  const body = [];
  if (email.from) body.push(el('p', 'muted small', `From ${email.from}`));
  body.push(el('p', '', email.text || 'No summary was kept of this message.'));
  body.push(button('Open in Gmail ↗', () => window.pilot.openExternal(email.url), 'soft-button'));
  return foldCard({title: email.title, tag: email.outcome, when: email.when, open: first}, ...body);
}

const noteCard = (note, first) => foldCard({iconName: 'chat', title: note.title, open: first}, ...note.lines.map(lineView));

export function messagesTab({job, page, parts, close}, redraw) {
  const {emails, notes, counts} = messagesOf(parts, page?.events);
  const add = button('Add note', () => openLogFor(job.url, job.title), 'soft-button');
  const nodes = [];
  if (gmailConnected() === false) {   // known not connected (null = not known yet: say nothing)
    nodes.push(stateCard({icon: 'alert', tone: 'warn', title: 'Connect Gmail to read new messages', text: 'Messages already linked to this job still show here.',
      actions: [button('Connect Gmail', () => { close(); openSetting('google'); }, 'primary')]}));
  }
  if (!counts.all && !parts.shots.length) {
    nodes.push(stateCard({icon: 'mail', title: 'No linked messages yet', text: 'Replies from the employer and the notes you log about this job show here.', actions: [add]}));
    return nodes;
  }
  const active = chosen.get(job.url) || 'all';
  const row = el('div', 'jd-filter');
  row.append(choice([['all', `All ${counts.all}`], ['email', `Email ${counts.email}`], ['note', `Notes ${counts.note}`]], active, key => { chosen.set(job.url, key); redraw(); }, 'Messages'), add);
  nodes.push(row);
  const shown = [...(active === 'note' ? [] : emails.map((email, n) => emailCard(email, n === 0 && active !== 'note'))),
    ...(active === 'email' ? [] : notes.map((note, n) => noteCard(note, !emails.length && active !== 'email' && n === 0)))];
  if (shown.length) nodes.push(...shown);
  else nodes.push(stateCard({icon: 'search', title: active === 'email' ? 'No emails linked to this job' : 'No notes on this job', text: 'Choose All to see everything linked.'}));
  if (active !== 'email') nodes.push(...shotsView(parts.shots));
  return nodes;
}
