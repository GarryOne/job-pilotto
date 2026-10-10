// Drawer → Description (owner's mock, 10 Oct 2026): a strip of facts (employer, posted, first found, the saved copy), the posting with its
// headings and bullets, and where it came from with "View original". The text is the page's own (a job you applied to), else the copy the
// search saved (IPC jobPosting, asked once per job and kept for the session). States: reading it, saved, none saved, could not be read (Retry,
// only after a failure). Words and blocks: renderer/job-page-view.js postingFacts, postingBlocks.
import {el} from '../components.js';
import {postingBlocks, postingFacts, postingSource} from '../job-page-view.js';
import {button, factStrip, postingBody, skeleton, sourceCard, stateCard} from './parts.js';

const read = new Map();   // job url → the answer of IPC jobPosting, for this session
const ICONS = {employer: 'building', posted: 'calendar', found: 'search', saved: 'file'};

function saved(text, job, found = {}) {
  const view = el('div', 'jd-description');
  view.append(factStrip(postingFacts(job, found, text).map(cell => ({...cell, icon: ICONS[cell.key]}))), el('h3', '', 'Description'), postingBody(postingBlocks(text)),
    sourceCard(postingSource(found), button('View original ↗', () => window.pilot.openExternal(job.url), 'soft-button')));
  return view;
}

const none = () => stateCard({icon: 'file', tone: 'warn', title: 'This job has no saved description', text: 'A copy of the original posting is saved with the job once it is read.'});

export function descriptionTab({job, parts}) {
  if (parts.descriptionText) return [saved(parts.descriptionText, job)];
  const box = el('div', 'jd-async');
  const paint = answer => {
    if (answer.failed) {
      box.replaceChildren(stateCard({icon: 'alert', tone: 'bad', title: 'Could not read the saved posting', text: answer.error, actions: [button('Retry', () => ask(true))]}));
      return;
    }
    box.replaceChildren(answer.ok && answer.description ? saved(answer.description, job, answer) : none());
  };
  const ask = again => {
    if (!again && read.has(job.url)) { paint(read.get(job.url)); return; }
    box.replaceChildren(...skeleton());
    window.pilot.jobPosting(job.url).catch(error => ({ok: false, failed: true, error: error.message})).then(answer => {
      if (!answer.failed) read.set(job.url, answer);
      paint(answer);
    });
  };
  ask(false);
  return [box];
}
