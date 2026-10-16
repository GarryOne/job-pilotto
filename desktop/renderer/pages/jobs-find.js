// Jobs page, the "Find jobs" card on top (owner, 16 Oct 2026): a big button on an empty first run, then the live progress of the search (steps, last
// lines, counts) with the list growing below it, then a one-line result; a failure says what to do. Built from the shared header, number strip, pills and
// rows (no new look). Data: renderer/find-card-model.js. Guarded by: test/find-card.test.js.
import {cardHead, el, numberStrip, pill} from '../components.js';
import {findCard} from '../find-card-model.js';
import {jobsState} from './jobs-state.js';
import {$, show} from './core.js';

let signature = '', wasSearching = false, finishedHere = false;
let start = () => {};
export const wireFindCard = startSearch => { start = startSearch; };

const button = (text, handler, className = 'primary') => Object.assign(el('button', className, text), {type: 'button', onclick: handler});

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
    card.replaceChildren(cardHead('Searching', model.listed ? `${model.listed} job${model.listed === 1 ? '' : 's'} so far` : 'Looking for your first jobs…', {subtitles: ['You can keep using Job Pilotto; matches appear below as they are scored.']}),
      numberStrip([{label: 'Listed', value: String(model.listed)}, {label: 'Scored', value: String(model.scored)}], {valueFirst: true}), chips, lines);
  } else if (model.state === 'done') {
    card.replaceChildren(cardHead('Search done', `${model.listed} job${model.listed === 1 ? '' : 's'} on your list`, {subtitles: ['The best matches are first. Find jobs again any time.']}));
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
  wasSearching = searching;
  const jobs = jobsState.lastJobsData?.jobs || [];
  const model = findCard({running: runsNow.running, last: (runsNow.runs || []).find(run => (run.kind || 'search') === 'search') || null,
    lastSearchAt: runsNow.lastSearchAt, listed: runsNow.listed ?? jobs.length, scored: jobs.filter(job => job.fit != null).length, finishedHere});   // runsNow.listed: only the screenshots set it
  const key = JSON.stringify(model);
  if (key === signature) return;
  signature = key;
  draw(model);
}

// The Find jobs card is showing its searching state: the rows without a score say Scoring… instead of Not scored.
export const searchingNow = () => document.body.dataset.findCard === 'searching';
