// Drawer → Interviews (owner's board 05): the job's interviews as cards that fold: what is scheduled (an invitation by email and the calendar
// entry for the same time are one) and what was recorded or practised (result, round, next step, the transcript, and the way to its review).
// None: a state card. Data: the page's events and its interview records (IPC jobPage); words: renderer/job-page-view.js interviewsOf.
import {el} from '../components.js';
import {shortDay} from '../date.js';
import {callFacts, interviewsOf, lineOf} from '../job-page-view.js';
import {button, foldCard, group, lineView, stateCard} from './parts.js';
import {openLogFor} from '../pages/jobs-lead.js';
import {showReview} from './tab-review.js';

function slotCard(item, first, page) {
  const body = [];
  if (item.source) body.push(el('p', 'muted small', item.source));
  if (item.note) body.push(el('p', '', item.note));
  const prep = page?.app?.interview_prep, calls = callFacts(page?.app);
  if (item.upcoming && (prep || calls)) body.push(el('p', 'muted small', [prep && `Prep by ${shortDay(prep) || prep}`, calls && `From the calls: ${calls}`].filter(Boolean).join(' · ')));
  if (!body.length) body.push(el('p', 'muted small', 'No details were kept for this interview.'));
  return foldCard({iconName: 'calendar', title: item.title, tag: item.status, when: item.when, open: first}, ...body);
}

// A transcript's turns: a speaker line ends with its time ("Sarah 02:14"), the words follow it; one row a turn, the time on the right.
const STAMP = /^(.*?)\s+(\d{1,2}:\d{2}(?::\d{2})?)$/;
function turns(lines) {
  const out = [];
  for (const line of lines) {
    const head = STAMP.exec(line.text);
    if (head) out.push({who: head[1], at: head[2], words: []});
    else if (out.length) out.at(-1).words.push(line.text);
    else out.push({who: '', at: '', words: [line.text]});
  }
  return out;
}
const turnRow = turn => {
  const row = el('div', 'iv-moment');
  const head = el('div', 'job-panel-line');
  head.append(el('b', '', turn.who), el('span', 'muted small', turn.at));
  row.append(head, el('div', '', turn.words.join(' ')));
  return row;
};

function recordCard(record, first, {job, pick}) {
  const body = [];
  if (record.round || record.overall) body.push(el('p', 'muted small', [record.round && `Round: ${record.round}`, record.overall && `Result: ${record.overall[0]}`, record.input && `From ${record.input.toLowerCase()}`].filter(Boolean).join(' · ')));
  if (record.nextStep) body.push(el('p', '', `Next step: ${record.nextStep}`));
  const rows = turns(record.transcript.split('\n').map(lineOf).filter(line => line.text));
  if (rows.length) body.push(group('Transcript', [...rows.slice(0, 3).map(turnRow), ...(rows.length > 3 ? [lineView({fold: `Show all ${rows.length} turns`, lines: rows.slice(3).map(turn => ({text: `${turn.who} ${turn.at}: ${turn.words.join(' ')}`, strong: false, todo: null, quote: false}))})] : [])]));
  else body.push(el('p', 'muted small', 'No transcript was kept.'));
  if (record.hasReview) body.push(button('View interview review →', () => { showReview(job.url, `iv-${record.key}`); pick('review'); }, 'soft-button'));
  return foldCard({iconName: 'mic', title: record.title, tag: record.overall?.[0] || '', when: record.when, open: first}, ...body);
}

export function interviewsTab({job, page, pick}) {
  const {upcoming, past, records} = interviewsOf(page);
  // Add interview: the Log box on this job (what you tell it about an interview becomes its event and record).
  const add = button('Add interview', () => openLogFor(job.url, job.title), 'soft-button');
  const cards = [...upcoming.map(item => ({item, slot: true})), ...records.map(item => ({item})), ...past.map(item => ({item, slot: true}))];
  if (!cards.length) {
    return [stateCard({icon: 'calendar', title: 'No interviews yet', text: 'When an interview is scheduled or practised for this job, it shows here with its prep, recording and transcript.', actions: [add]})];
  }
  const head = el('div', 'jd-filter');
  head.append(el('b', '', 'Interviews'), add);
  return [head, ...cards.map(({item, slot}, n) => (slot ? slotCard(item, n === 0, page) : recordCard(item, n === 0, {job, pick})))];
}
