// Jobs page, the "Find jobs" card on top (owner, 16 Oct 2026): a big button on an empty first run, then the live progress of the search (steps, last
// lines, counts) with the list growing below it, then a one-line result; a failure says what to do. Built from the shared header, number strip, pills and
// rows (no new look). Data: renderer/find-card-model.js. Guarded by: test/find-card.test.js.
import {cardHead, el, numberStrip, pill, setCount} from '../components.js';
import {jobCounts} from '../jobs-view.js';
import {findCard} from '../find-card-model.js';
import {jobsState} from './jobs-state.js';
import {$, show} from './core.js';

let signature = '', wasSearching = false, finishedHere = false, shown = {};
let start = () => {};
export const wireFindCard = startSearch => { start = startSearch; };

const button = (text, handler, className = 'primary') => Object.assign(el('button', className, text), {type: 'button', onclick: handler});

// This search's three numbers (find-card-model.js runCounts): possible matches (rising as each employer is read), scored, good fits 70+. While searching they flash when they go up, like the counters below
// (components.js setCount): the card is drawn again at every change, so each new number starts from the one shown before.
function runNumbers(model, live = true) {
  const cells = [['Found', 'matches'], ['Scored', 'scored'], ['Good fits (70+)', 'good']];
  const strip = numberStrip(cells.map(([label, key]) => ({label, value: String(model[key])})), {valueFirst: true});
  strip.querySelectorAll('.insight-number-value').forEach((node, i) => {
    const key = cells[i][1], before = shown[key];
    if (live && before !== undefined && before !== model[key]) { node.textContent = before; node.dataset.counted = '1'; setCount(node, model[key]); }
    if (live) shown[key] = model[key];
  });
  return strip;
}

// Employers read as progress (bar + "1,953 of 2,251"). The raw count of downloaded listings is not shown: 130k+ is noise (owner, 19 Oct 2026).
function readProgress(model) {
  const box = el('div', 'find-progress'), n = value => value.toLocaleString('en-US');
  if (model.employers) {
    const {done, total} = model.employers, head = el('div', 'progress-head'), bar = el('div', 'bar'), fill = el('span');
    fill.style.width = `${total ? Math.max(2, Math.min(100, Math.round(100 * done / total))) : 2}%`;
    bar.append(fill);
    head.append(el('span', '', 'Employers read'), el('span', 'muted', `${n(done)} / ${n(total)}`));
    box.append(head, bar);
  }
  return box;
}

function draw(model) {
  const card = $('find-card');
  card.className = `card find-card is-${model.state}`;
  if (model.state === 'empty') {
    const big = button('Find my first jobs', () => start(), 'primary find-big');
    card.replaceChildren(cardHead('Get started', 'Find your first jobs', {subtitles: ['Reads employer sites and job boards, scores each job against your profile, and lists the first matches in under a minute. The rest keeps coming.']}), big);
  } else if (model.state === 'searching') {
    const chips = el('div', 'chip-row');
    chips.append(...model.chips.map(chip => pill(chip.label, chip.state === 'active' ? 'signal' : chip.state === 'done' ? 'good' : 'neutral', {dot: chip.state === 'active'})));
    const lines = el('ul', 'run-card-rows');
    lines.append(...model.lines.map(text => el('li', 'run-card-row', text)));
    card.replaceChildren(cardHead('Searching', model.matches ? `${model.matches} found so far, ${model.scored} scored` : 'Looking for your first jobs…', {subtitles: ['The numbers are this search only. You can keep using Job Pilotto; a found job joins your matches below once it is scored.']}),
      runNumbers(model), readProgress(model), chips, lines);
  } else if (model.state === 'done') {
    const ran = model.looked || model.matches || model.scored;   // an older run has no counts line: the list's count, as before
    card.replaceChildren(cardHead('Search done', ran ? `${model.matches} found, ${model.scored} scored` : `${model.listed} match${model.listed === 1 ? '' : 'es'} on your list`, {subtitles: ['The best matches are first. Find jobs again any time.']}),
      ...(ran ? [runNumbers(model, false)] : []));
  } else if (model.state === 'failed') {
    card.replaceChildren(cardHead('Search stopped', 'The search did not finish', {subtitles: [model.problem || 'Nothing is lost. Try again; if it keeps stopping, check your AI settings.']}),
      button('Try again', () => start()));
  }
  show(card, model.state !== 'none');
  document.body.dataset.findCard = model.state;
}

// Called every 2 s with the runs state, and after the list loads.
export function renderFindCard(runsNow) {
  if (!$('find-card') || !runsNow) return;
  const searching = !!runsNow.running && (runsNow.running.kind || 'search') === 'search';
  if (wasSearching && !searching) finishedHere = true;
  if (searching) finishedHere = false;
  if (searching && !wasSearching) shown = {};   // a new search starts from 0
  wasSearching = searching;
  const counts = jobCounts(jobsState.lastJobsData);   // the same numbers as the counters below (jobs-view.js)
  const model = findCard({running: runsNow.running, last: (runsNow.runs || []).find(run => (run.kind || 'search') === 'search') || null,
    lastSearchAt: runsNow.lastSearchAt, listed: runsNow.listed ?? counts.total, finishedHere});   // runsNow.listed: only the screenshots set it
  const key = JSON.stringify(model);
  if (key === signature) return;
  signature = key;
  draw(model);
}

// The Find jobs card is showing its searching state: the rows without a score say Scoring… instead of Not scored.
export const searchingNow = () => document.body.dataset.findCard === 'searching';
