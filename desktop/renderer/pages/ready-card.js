// The Ready to send card on Actions (spec docs/superpowers/specs/2026-10-17-ready-to-send.md), always shown (owner, 18 Oct 2026); it works only when the site says this install is the owner's, else it says why with its buttons off: send tonight's finished jobs to be filled overnight,
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
  if (night?.aiStopped) body.append(el('div', 'muted', "Your AI stopped during the night (its limit or the night's cost cap): open questions are left for you, the rest is filled."));
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
  if (state.sent) body.append(el('div', 'muted', `Sent for tonight: ${state.sent.count} job${state.sent.count === 1 ? '' : 's'} · ${new Date(state.sent.at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hour12: false})}. It is sent again by itself when this list changes and before your Mac goes off.`));
  body.append(el('div', 'muted', tonight.length ? `Tonight: ${tonight.length} of your finished jobs (fit ≥ ${state.settings.minFit}, up to ${state.settings.perNight})` : 'Tonight: no job has its kit, CV and cover letter ready yet. Tailor CVs first.'));
}

export function build() {
  const card = el('div', 'task-card is-medium ready-card'), words = el('div', 'task-words');
  card.append(el('span', 'task-category', 'APPLICATIONS'));
  const main = el('div', 'task-body'), send = el('button', 'secondary action', 'Fill tonight on the server'), run = el('button', 'secondary action', 'Fill now');
  send.id = 'ready-send'; send.dataset.palette = 'ready'; run.id = 'ready-run';
  const hidden = el('b', '', 'Ready to send: fill tonight\'s forms on the server (nothing is submitted)'); hidden.hidden = true; send.prepend(hidden);
  words.append(el('b', '', 'Ready to send'), el('span', 'muted', 'Your finished jobs are filled on our server overnight. Nothing is submitted: in the morning you open a filled form and press Submit yourself.'));
  main.append(tile('moon'), words, send, run);
  card.append(main, el('div', 'ready-body'), el('div', 'muted ready-note'));
  return {card, send, run};
}

// Not working right now (no owner key, no token today, the site refused or is down): the card stays, says why, and its two buttons are off.
export function blocked(card, why, retry) {
  const body = card.querySelector('.ready-body'), again = el('button', 'secondary', 'Try again');
  const checked = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
  // Try again answers visibly (owner, 18 Oct 2026: "no feedback. No reaction"): Checking… while it asks, then the reason with the time it was checked.
  again.addEventListener('click', () => { again.disabled = true; again.textContent = 'Checking…'; retry(); });
  body.textContent = '';
  const status = el('div', 'ready-status');
  status.append(pill('Not available', 'warn'), el('span', 'muted', `${why || 'Our server did not answer.'} · checked ${checked}`), again);
  body.append(status);
  for (const button of card.querySelectorAll('.task-body button')) { button.disabled = true; button.title = why || ''; }
}

export async function initReadyCard() {
  const anchor = $('tailor-top')?.closest('.task-pair');
  if (!anchor) return;
  const {card, send, run} = build(), note = card.querySelector('.ready-note'), names = {};
  send.disabled = run.disabled = true;
  card.querySelector('.ready-body').append(el('div', 'muted', 'Checking our server…'));
  anchor.after(card);   // shown at once, always (owner, 18 Oct 2026); what it can do follows
  let tonightNow = null;
  const show = state => {
    if (!state?.owner) return blocked(card, state?.why, refresh);
    send.disabled = run.disabled = false; send.title = run.title = '';
    Object.assign(names, state.names || {});
    paint(card, {...state, tonight: tonightNow ?? state.tonight}, names, act);
  };
  // The night's rows, then what tonight would send from a fresh job read (the first paint uses the last kept list).
  const refresh = async () => {
    const state = await window.pilot.readyState().catch(error => ({owner: false, why: error.message}));
    show(state);
    if (!state?.owner) return;
    const fresh = await window.pilot.readyTonight().catch(() => null);
    if (fresh?.ok) { tonightNow = fresh.tonight; show({...state, names: {...state.names, ...fresh.names}}); }
  };
  const act = {live: code => { const button = el('button', 'secondary', 'Open live'); button.title = 'See this form in your browser and press Submit yourself'; button.addEventListener('click', async () => { const result = await window.pilot.readyLive(code).catch(error => ({ok: false, error: error.message})); if (!result.ok) say(result.error || 'Could not open it.'); }); return button; },
    done: code => { const button = el('button', 'secondary', 'Done'); button.title = 'Delete this form\'s data from the server'; button.addEventListener('click', async () => { await window.pilot.readyDone(code); refresh(); }); return button; }};
  const say = text => { note.textContent = text; };
  send.addEventListener('click', async () => {
    send.disabled = true; say('Handing tonight\'s jobs to the server to fill (nothing is submitted)…');
    const result = await window.pilot.readySend().catch(error => ({ok: false, error: error.message}));
    say(result.ok ? `${result.queued} job${result.queued === 1 ? '' : 's'} will be filled on the server for the night of ${result.night}, not submitted${result.skipped?.length ? ` · ${result.skipped.length} left out (${result.skipped[0].why})` : ''}.` : (result.error || 'Could not send.'));
    refresh();
  });
  run.addEventListener('click', async () => {
    run.disabled = true;
    const result = await window.pilot.readyRun().catch(error => ({ok: false, error: error.message}));
    say(result.ok ? 'Filling started on the server. Results appear here as each form is filled; nothing is submitted.' : (result.error || 'Could not start.'));
    refresh(); setTimeout(refresh, 30000);
  });
  await refresh();
}
