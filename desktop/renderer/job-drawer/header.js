// The drawer's fixed header (pages/job-panel.js): the score ring, the title, "company · place", the job's own status and key chips, and
// the controls: previous / next ("3 of 38"), expand, close; "Back to Recent activity" above them when a run opened the job.
// One header for every tab. Words: renderer/job-page-view.js headerFacts, interviewFacts. Guarded by test/job-drawer.test.js.
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {fitRing} from '../fit-ring.js';
import {band} from '../jobs-view.js';
import {appliedLine, nextInterview} from '../job-page-view.js';

function control(name, title, run, disabled = false) {
  const node = Object.assign(el('button', 'ghost icon-btn jd-control'), {type: 'button', title, disabled});
  node.setAttribute('aria-label', title);
  node.append(typeof name === 'string' ? icon(name) : name);
  node.addEventListener('click', run);
  return node;
}

// at: {index, total} of the list the drawer was opened from; back: {label, run} or null; on: {prev, next, expand, close}.
export function drawerHeader(job, page, {at, back, expanded, on}) {
  const head = el('header', 'jd-head');
  if (back) {
    const link = Object.assign(el('button', 'link jd-back', `← ${back.label}`), {type: 'button'});
    link.addEventListener('click', back.run);
    head.append(link);
  }
  const top = el('div', 'jd-top');
  const cell = el('div', `fit-cell ${band(job.fit)}`);
  cell.append(fitRing(job.fit, 'lg'));
  const words = el('div', 'jd-title');
  words.append(el('h2', '', job.title), el('p', 'muted', [job.company, job.location || page?.app?.location].filter(Boolean).join(' · ')));
  const chips = el('div', 'jd-chips');
  const stage = page?.app?.stage || job.stage;
  if (stage) chips.append(pill(stage, 'info'));
  if (job.work_mode) chips.append(pill(job.work_mode, 'neutral'));
  const applied = appliedLine(job, page?.app);
  if (applied) chips.append(el('span', 'muted small', applied));
  if (chips.childNodes.length) words.append(chips);
  const nav = el('div', 'jd-nav');
  const flip = control('chevron', 'Previous job', on.prev, !at || at.index <= 0);
  flip.classList.add('is-flipped');
  nav.append(flip, el('span', 'muted small jd-count', at && at.total > 1 ? `${at.index + 1} of ${at.total}` : ''),
    control('chevron', 'Next job', on.next, !at || at.index >= at.total - 1),
    control('maximize', expanded ? 'Shrink' : 'Expand to the full width', on.expand), control('close', 'Close (Esc)', on.close));
  top.append(cell, words, nav);
  head.append(top);
  const next = nextInterview(page?.app);
  if (next) {   // the next step, on every tab: when, and the way to its interview
    const bar = el('div', 'jd-next');
    const open = Object.assign(el('button', 'primary', 'Open interviews →'), {type: 'button'});
    open.addEventListener('click', on.interviews);
    bar.append(icon('calendar'), el('span', '', `Next interview · ${next.when}`), open);
    head.append(bar);
  }
  return head;
}
