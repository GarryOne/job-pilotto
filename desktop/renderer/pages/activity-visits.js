// Recent activity: the site-reading (visits) card and the busy-button memory (presses) its buttons share.
// Split out of activity.js as a pure move. Guarded by the tests that read the activity-*.js sources (desktop/test/activity-source.js) and the e2e activity suites.
import {el} from '../components.js';
import {claudeHelp} from '../claude-help.js';
import {shared} from './shared.js';
import {$} from './core.js';
import {toastMessage} from './startup.js';
import {plural, runButton} from './activity-basics.js';
// A button on a card Recent activity redraws (on every log line and refresh): what it is doing lives here by key, not on the button, so a redraw
// keeps "Starting Claude…" or its "✓", and the outcome lands on the button now on screen (7 Oct 2026: Read with Claude, then the few-jobs box,
// showed no loading: the busy button was replaced by a fresh one). Every such button goes through keepPress + pressWhile (a test checks).
const presses = new Map();          // key -> {busy, done, text, error}
const pressedButtons = new Map();   // key -> its button on screen now
function paintPress(key) {
  const state = presses.get(key), button = pressedButtons.get(key);
  if (!state || !button) return;
  if (state.text) button.textContent = state.text;
  button.disabled = !!(state.busy || state.done);
  button.toggleAttribute('aria-busy', !!state.busy);
}
export function keepPress(key, button) { pressedButtons.set(key, button); paintPress(key); return button; }
export function setPress(key, state) { presses.set(key, {...presses.get(key), ...state}); paintPress(key); }
export const pressedButton = key => pressedButtons.get(key);
const pressError = key => presses.get(key)?.error || '';
export async function pressWhile(key, busyText, work) {
  setPress(key, {busy: true, error: '', ...(busyText ? {text: busyText} : {})});
  try { return await work(); } finally { setPress(key, {busy: false}); }
}

// A Read with Claude session that finished or stopped: its button comes back, with what it read in the row (owner, 7 Oct 2026: "the button
// stays on 'Claude is reading in Chrome' even after the session ends"; "Read with Claude never reports back").
const claudeGroups = new Map();   // first site's address -> every site one "Read the stopped sites with Claude" session reads
function claudeReadEnded(url, said) {
  for (const each of claudeGroups.get(url) || [url]) claudeSiteEnded(each, said);
  claudeGroups.delete(url);
  const all = [...presses.keys()].find(key => key.startsWith('claude-all:') && key.includes(url));
  if (all) setPress(all, {done: false, text: presses.get(all).idle || 'Read them with Claude'});
}
function claudeSiteEnded(url, said) {
  const key = `claude:${url}`;
  if (!presses.get(key)?.done) return;
  setPress(key, {done: false, text: 'Read with Claude', error: said});
  const shown = pressedButton(key)?.closest('li')?.querySelector('.item-words, .site-words');
  shown?.querySelector('.visit-claude-error')?.remove();
  shown?.append(el('span', 'muted visit-claude-error', said));
}
window.pilot?.onVisitClaudeDone?.(result => {
  claudeReadEnded(result.url, `Claude read ${result.jobs} job${result.jobs === 1 ? '' : 's'}${(result.urls || []).length > 1 ? ` from ${result.urls.length} sites` : ''}, ${result.fits} matching your search`);
  toastMessage(`Claude read ${result.jobs} jobs from ${result.name || 'the site'}, ${result.fits} matching your search`,
    result.fits ? 'The matching ones are being scored now (about a minute): those that fit your profile join your Jobs list.' : 'None has your role words and places, so your Jobs list stays the same.');
});
window.pilot?.onSession?.((event, payload) => {   // a session that stopped without finishing (closed, failed)
  if (event === 'update' && payload?.kind === 'read' && ['ended', 'failed'].includes(payload.status)) claudeReadEnded(payload.url, `Claude's session ${payload.status === 'failed' ? 'stopped' : 'ended'} before it finished`);
});

// A stopped site's "Read with Claude", the same in the result card's list and in the run's site rows (siteRow): one key per site, so a
// session started from either is followed in both. `words` gets the error line.
const WORDS = '.item-words, .site-words';
export function claudeReadButton(site, words) {
  const claude = el('button', 'secondary item-action', 'Read with Claude');
  claude.type = 'button';
  claude.title = 'A Claude in Chrome session opens this site, sets the filters for your search and reads its jobs (needs Claude Code)';
  // Starting a Claude session takes ~10 s (owner, 7 Oct 2026: "I press, nothing happens"): said on the button, the way Re-score does it,
  // then it stays off while that session reads; a refusal is said in the row.
  const key = `claude:${site.url}`;
  keepPress(key, claude);
  if (pressError(key)) words.append(el('span', 'muted visit-claude-error', pressError(key)));
  claude.addEventListener('click', async () => {
    const started = await pressWhile(key, 'Starting Claude…', () => window.pilot.visitWithClaude(site.url, site.name)).catch(error => ({ok: false, error: error.message}));
    if (started?.ok) { setPress(key, {done: true, text: 'Claude is reading in Chrome'}); return; }
    setPress(key, {text: 'Read with Claude', error: started?.error || 'Claude could not start.'});
    const shown = pressedButton(key)?.closest('li')?.querySelector(WORDS);
    shown?.querySelector('.visit-claude-error')?.remove();
    shown?.append(el('span', 'muted visit-claude-error', pressError(key)));
  });
  return claude;
}

// "Find jobs using your browser" (renderer/visits-card.js): the counts, a row per site read, and a stopped site's ways on (owner's mockup,
// 7 Oct 2026): Read with Claude (a Claude in Chrome session, when the extension could not) and Open it myself.
// list: false when the run's step card already lists the sites with their marks and buttons (Recent activity), so they are not shown twice
// (owner, 7 Oct 2026); the Actions page has no step card and keeps the list.
export function renderVisitsCard(card, target = $('activity-card'), {list: withList = true} = {}) {
  const box = el('div', 'insight-card');
  const head = el('header', 'insight-head');
  const kicker = el('div', 'insight-kicker');
  kicker.append(el('span', 'insight-category', 'Sites only you can open'));
  const onlyPostings = !card.total && card.postings;   // a run of "Jobs we couldn't read" only: no site was ticked
  head.append(kicker, el('h3', 'insight-title', onlyPostings ? `Read ${card.postings.read} of ${plural(card.postings.asked, 'job')} we couldn't read` : card.fits === null ? `Read ${card.read} of ${plural(card.total, 'site')} · ${plural(card.jobs, 'job')} (${card.fresh} new)`
    : `Read ${plural(card.jobs, 'job')}, ${card.fits} matching your search`));   // the reading works, said first; how many reach Jobs beside it (owner)
  // How many reach Jobs, said plainly (owner, 7 Oct 2026: "Read 5 jobs, but my Jobs count never grows"): only those with your role words and places.
  head.append(el('p', 'insight-subtitle', card.fits === null ? 'Your next jobs check filters and scores them like any other.'
    : `From ${card.read} of ${plural(card.total, 'site')}. ` + (card.fits && card.listed !== null && card.listed !== undefined
      ? `Scored before this run ended: ${plural(card.listed, 'job')} added to your Jobs list${card.listed < card.fits ? ' (the others did not fit your profile, or were there already)' : ''}.`
      : card.fits ? (card.fits === 1 ? 'The matching one is being scored now (about a minute, first in line): if it fits your profile, it joins your Jobs list.' : 'The matching ones are being scored now (about a minute, first in line): those that fit your profile join your Jobs list.')
      : 'None has your role words and places, so your Jobs list stays the same.')));
  // Postings only your browser could open (lib/visits.js readPostings): how many were read, said under the sites' line; scored with them above.
  if (card.postings && !onlyPostings) head.append(el('p', 'insight-subtitle', `Jobs we couldn't read: ${card.postings.read} of ${card.postings.asked} read in your browser, scored with the rest.`));
  // Two or more stopped sites: one Claude session reads them all, in turn (owner, 7 Oct 2026: "a 'Read the failed sites with Claude' button").
  const stopped = card.sites.filter(site => !site.ok).slice(0, 10);   // one session reads at most 10 (main.js visitsWithClaude)
  const allStopped = card.sites.filter(site => !site.ok).length;
  const ways = el('div', 'visits-claude-all inline');
  // Run again, the stopped sites ticked (owner, 8 Oct 2026: a run that read 2 of 4 had no Run again): the dialog opens with them, as the failure
  // box's Run again does for a failed run (shared.visitsPreselect, pages/actions.js).
  if (allStopped && card.sites.some(site => site.ok)) {
    const again = el('button', 'secondary', `Run again on the ${allStopped === 1 ? 'stopped site' : `${allStopped} stopped sites`}`);
    again.type = 'button';
    again.title = 'Opens Find jobs using your browser with these sites ticked';
    again.addEventListener('click', () => {
      shared.visitsPreselect = card.sites.filter(site => !site.ok).map(site => ({name: site.name, url: site.url}));
      runButton('visits')?.click();
    });
    ways.append(again);
  }
  if (stopped.length > 1 && claudeHelp()) {   // only with Claude help on (claude-help.js)
    const idle = allStopped > stopped.length ? `Read the first ${stopped.length} of ${allStopped} stopped sites with Claude` : `Read the ${stopped.length} stopped sites with Claude`;
    const all = el('button', 'secondary', idle);
    all.type = 'button';
    all.title = 'One Claude in Chrome session opens them one after the other, sets their filters for your search and reads their jobs (needs Claude Code)';
    const key = `claude-all:${stopped.map(site => site.url).join(' ')}`;
    keepPress(key, all);
    presses.set(key, {...presses.get(key), idle});
    all.addEventListener('click', async () => {
      const started = await pressWhile(key, 'Starting Claude…', () => window.pilot.visitsWithClaude(stopped.map(site => ({url: site.url, name: site.name})))).catch(error => ({ok: false, error: error.message}));
      if (!started?.ok) { setPress(key, {text: idle, error: started?.error || 'Claude could not start.'}); toastMessage('Claude did not start', started?.error || ''); return; }
      setPress(key, {done: true, text: `Claude is reading ${stopped.length} sites in Chrome`});
      claudeGroups.set(stopped[0].url, stopped.map(site => site.url));
      for (const site of stopped) setPress(`claude:${site.url}`, {done: true, text: 'Claude is reading in Chrome'});
    });
    ways.append(all);
  }
  if (ways.children.length) head.append(ways);
  const list = el('ul', 'item-rows');
  for (const site of card.sites) {
    const row = el('li', site.ok ? '' : 'is-failed');
    row.append(el('span', `site-mark ${site.ok ? 'done' : 'fail'}`));   // the run's ✓ / ✕, as in its live rows
    const words = el('div', 'item-words');
    words.append(el('b', '', site.name), el('span', 'muted', site.detail));
    row.append(words);
    if (!site.ok) {
      const claude = claudeHelp() ? claudeReadButton(site, words) : null;   // only with Claude help on (claude-help.js)
      const myself = el('button', 'link item-action', 'Open it myself');
      myself.type = 'button';
      myself.addEventListener('click', () => window.pilot.openVisit(site.url));
      row.append(...[claude, myself].filter(Boolean));
    } else {   // a site read: open it yourself too, the same link in the same place
      const myself = el('button', 'link item-action', 'Open it myself');
      myself.type = 'button';
      myself.addEventListener('click', () => window.pilot.openVisit(site.url));
      row.append(myself);
    }
    list.append(row);
  }
  box.append(...(withList ? [head, list] : [head]));
  target.replaceChildren(box);
}
