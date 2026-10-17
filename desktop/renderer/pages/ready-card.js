// The Ready to send card on Actions (spec docs/superpowers/specs/2026-10-17-ready-to-send.md), shown ONLY when the site says this install is the owner's: send tonight's finished jobs to be filled overnight,
// start the night now (the test), and in the morning one row per form (complete, what is left, a wall) with Done. You press Submit; nothing here does. Built from the task-card parts the Tailor card uses (.task-card, .task-body, pill). Guard: test/ready-card.test.js.
import {el, pill, tile} from '../components.js';
import {$} from './core.js';
import {rowOf} from './ready-rows.js';

// state: what readyState gave. names: code -> "Title · Company" for the rows.
export function paint(card, state, names, act) {
  const body = card.querySelector('.ready-body'), jobs = (state.site?.jobs || []).filter(job => !job.cleared_at), night = state.site?.batch;
  body.textContent = '';
  const tonight = state.tonight || [];
  body.append(el('div', 'muted', night ? `Last night (${night.night}): ${jobs.length} form${jobs.length === 1 ? '' : 's'} · $${(night.costUsd || 0).toFixed(2)} of AI and servers` : 'Nothing sent yet.'));
  const rows = el('div', 'ready-rows');
  for (const job of jobs) {
    const row = rowOf(job), line = el('div', 'ready-row');
    const buttons = el('span', 'ready-buttons');
    if (['prepared', 'partial', 'wall'].includes(job.state)) buttons.append(act.live(job.job));
    buttons.append(act.done(job.job));
    line.append(el('span', 'ready-name', names[job.job] || job.host), pill(row.text, row.tone), buttons);
    rows.append(line);
  }
  if (jobs.length) body.append(rows);
  body.append(el('div', 'muted', tonight.length ? `Tonight: ${tonight.length} of your finished jobs (fit ≥ ${state.settings.minFit}, up to ${state.settings.perNight})` : 'Tonight: no job has its kit, CV and cover letter ready yet. Tailor CVs first.'));
}

export function build() {
  const card = el('div', 'task-card is-medium ready-card'), words = el('div', 'task-words');
  card.append(el('span', 'task-category', 'APPLICATIONS'));
  const main = el('div', 'task-body'), send = el('button', 'secondary action', 'Send tonight'), run = el('button', 'secondary action', 'Run now');
  send.id = 'ready-send'; send.dataset.palette = 'ready'; run.id = 'ready-run';
  const hidden = el('b', '', 'Ready to send: fill tonight\'s forms overnight'); hidden.hidden = true; send.prepend(hidden);
  words.append(el('b', '', 'Ready to send'), el('span', 'muted', 'Your finished jobs are filled on Cloudflare overnight. In the morning you press Submit.'));
  main.append(tile('moon'), words, send, run);
  card.append(main, el('div', 'ready-body'), el('div', 'muted ready-note'));
  return {card, send, run};
}

export async function initReadyCard() {
  const state = await window.pilot.readyState().catch(() => null);
  const anchor = $('tailor-top')?.closest('.task-pair');
  if (!state?.owner || !anchor) return;
  const {card, send, run} = build(), note = card.querySelector('.ready-note'), names = {};
  const refresh = async () => { const next = await window.pilot.readyState().catch(() => null); if (next?.owner) { Object.assign(names, next.names || {}); paint(card, next, names, act); } };
  const act = {live: code => { const button = el('button', 'secondary', 'Open live'); button.title = 'See this form in your browser and press Submit yourself'; button.addEventListener('click', async () => { const result = await window.pilot.readyLive(code).catch(error => ({ok: false, error: error.message})); if (!result.ok) say(result.error || 'Could not open it.'); }); return button; },
    done: code => { const button = el('button', 'secondary', 'Done'); button.title = 'Delete this form\'s data from the server'; button.addEventListener('click', async () => { await window.pilot.readyDone(code); refresh(); }); return button; }};
  const say = text => { note.textContent = text; };
  send.addEventListener('click', async () => {
    send.disabled = true; say('Sending tonight\'s jobs…');
    const result = await window.pilot.readySend().catch(error => ({ok: false, error: error.message}));
    say(result.ok ? `${result.queued} job${result.queued === 1 ? '' : 's'} queued for the night of ${result.night}${result.skipped?.length ? ` · ${result.skipped.length} left out (${result.skipped[0].why})` : ''}.` : (result.error || 'Could not send.'));
    send.disabled = false; refresh();
  });
  run.addEventListener('click', async () => {
    run.disabled = true;
    const result = await window.pilot.readyRun().catch(error => ({ok: false, error: error.message}));
    say(result.ok ? 'The night started. Results appear here as each form is filled.' : (result.error || 'Could not start.'));
    run.disabled = false; setTimeout(refresh, 30000);
  });
  anchor.after(card);
  Object.assign(names, state.names || {});
  paint(card, state, names, act);
}
