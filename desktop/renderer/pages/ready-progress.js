// The Ready to send card's progress bar (owner, 18 Oct 2026: "I'd expect it to start instantly", "some progress bar", statuses as badges): Sending > Starting the server >
// Filling k of n > Ready, from the card's own press first (shown before any answer), then the site's night (/state). progressOf is pure; strip() draws it from the
// app's pill parts. Guard: test/ready-fill-now.test.js (the steps), test/ready-card.test.js (on the card).
import {el, pill} from '../components.js';

const FINISHED = ['finished', 'capped', 'deleted'];
const step = (label, state) => ({label, state});

// phase: 'idle' (no press), 'sending' (pressed, the send is on its way), 'started' (the site took it), 'failed' (with error). batch/jobs: the site's night.
// -> {steps: [{label, state: done|now|todo|bad}], percent} or null when there is nothing to follow.
export function progressOf({phase = 'idle', batch = null, jobs = [], error = ''} = {}) {
  if (phase === 'failed') return {steps: [step(error || 'Could not start', 'bad')], percent: 0};
  if (phase === 'sending') return {steps: [step('Sending', 'now'), step('Starting the server', 'todo'), step('Filling', 'todo'), step('Ready', 'todo')], percent: 5};
  const state = batch?.state, running = state === 'running' || (phase === 'started' && state === 'queued');
  if (!running && !(phase === 'started' && FINISHED.includes(state))) return null;
  const total = jobs.length, back = jobs.filter(job => job.state && job.state !== 'queued').length, sent = step(`Sent ${total} job${total === 1 ? '' : 's'}`, 'done');
  if (FINISHED.includes(state) || (total && back === total)) return {steps: [sent, step('Server up', 'done'), step(`Filled ${back}`, 'done'), step('Ready', 'done')], percent: 100};
  if (state === 'queued' || !back && state !== 'running') return {steps: [sent, step('Starting the server', 'now'), step('Filling', 'todo'), step('Ready', 'todo')], percent: 15};
  if (!back) return {steps: [sent, step('Starting the server', 'now'), step('Filling', 'todo'), step('Ready', 'todo')], percent: 20};
  return {steps: [sent, step('Server up', 'done'), step(`Filling ${Math.min(back + 1, total)} of ${total}`, 'now'), step('Ready', 'todo')], percent: Math.round(25 + 70 * back / total)};
}

const TONE = {done: 'good', now: 'info', todo: 'neutral', bad: 'bad'};
// The strip: the steps as pills with a separator, the bar under them. `since`: when the step now running began (ms), shown as m:ss on it and ticked by tick().
export function strip(progress, since = 0) {
  const box = el('div', 'ready-progress'), steps = el('div', 'ready-steps');
  progress.steps.forEach((each, i) => {
    if (i) steps.append(el('span', 'ready-sep', '›'));
    const chip = pill(`${each.state === 'done' ? '✓ ' : ''}${each.label}`, TONE[each.state], {dot: each.state === 'now'});
    if (each.state === 'now') { chip.classList.add('is-live'); if (since) chip.append(el('span', 'ready-clock', '')); }
    steps.append(chip);
  });
  const bar = el('div', 'ready-bar'), fill = el('i', '');
  fill.style.width = `${progress.percent}%`;
  bar.append(fill); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuenow', String(progress.percent));
  box.append(steps, bar);
  box.dataset.since = String(since || '');
  tick(box);
  return box;
}

// Updates the clock on the running step (every second while a strip is shown); no network.
export function tick(box, now = Date.now()) {
  const clock = box?.querySelector('.ready-clock'), since = Number(box?.dataset.since);
  if (!clock || !since) return;
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  clock.textContent = ` ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}
