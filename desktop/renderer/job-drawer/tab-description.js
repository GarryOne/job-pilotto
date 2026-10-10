// Drawer → Description: the posting as saved on the job (its page's description section, or frozen in its application record), else the
// copy the search saved (IPC jobPosting, asked once per job and kept for the session). States: reading it, saved (with its source), none saved,
// could not be read (Retry, only after a failure). Replaced by the next tab switch like any tab.
import {el} from '../components.js';
import {groupsOf} from '../job-page-view.js';
import {button, group, skeleton, stateCard} from './parts.js';

const read = new Map();   // job url → the answer of IPC jobPosting, for this session

function saved(groups, job) {
  const source = el('div', 'jd-source');
  source.append(el('span', 'muted small', 'Source: the posting the search saved'), button('Open original ↗', () => window.pilot.openExternal(job.url)));
  return [...groups.map(part => group(part.title, part.lines)), source];
}

const none = () => stateCard({icon: 'file', tone: 'warn', title: 'This job has no saved description', text: 'A copy of the original posting is saved with the job once it is read.'});

export function descriptionTab({job, parts}) {
  if (parts.groups.description.length) return saved(parts.groups.description, job);
  const box = el('div', 'jd-async');
  const paint = answer => {
    if (answer.failed) {
      box.replaceChildren(stateCard({icon: 'alert', tone: 'bad', title: 'Could not read the saved posting', text: answer.error, actions: [button('Retry', () => ask(true))]}));
      return;
    }
    const groups = answer.ok ? groupsOf(answer.description) : [];
    box.replaceChildren(...(groups.length ? saved(groups, job) : [none()]));
  };
  const ask = again => {
    if (!again && read.has(job.url)) { paint(read.get(job.url)); return; }
    box.replaceChildren(...skeleton());
    window.pilot.jobPosting(job.url).catch(error => ({ok: false, failed: true, error: error.message})).then(answer => {
      if (!answer.failed) read.set(job.url, answer);
      if (box.isConnected || !box.parentNode) paint(answer);
    });
  };
  ask(false);
  return [box];
}
