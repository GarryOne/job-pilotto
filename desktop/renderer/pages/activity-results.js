// Recent activity: the result of a finished task shown once, and the kept status bar / kept Recent activity.
// Split out of activity.js as a pure move. Guarded by the tests that read the activity-*.js sources (desktop/test/activity-source.js) and the e2e activity suites.
import {unseenRun, withShown} from '../result-seen.js';
import {el, pill} from '../components.js';
import {plainMessage} from '../run-cards.js';
import {shared} from './shared.js';
import {$, show} from './core.js';
import {clockTime, KIND, kindOf, runResults, capital, outcome, cardFor} from './activity-basics.js';
import {lastActivity, renderActivity} from './activity-render.js';
import {renderCardSkeleton} from './activity-run-card.js';
function showActionsResult(run, kind, draw) {
  show($('command-answer'), false);
  const [label, tone] = run.ok && !run.off ? ['Completed', 'good'] : ['Needs a look', 'bad'];
  $('actions-result-head').replaceChildren(el('b', '', `${kind.icon} ${kind.name}`), pill(label, tone), el('span', 'muted', `Finished ${clockTime(run.endedAt || run.startedAt)}`));
  draw($('actions-card'));
  show($('actions-result'));
  $('actions-result').scrollIntoView({behavior: 'smooth', block: 'nearest'});
}
// The Actions page shows the newest finished run's result as a card at the top, for every kind of task, however it started (your click, a schedule, Always on,
// before a reload): the run the owner has not seen yet. "Seen" is the id of the last run whose card was shown here or dismissed, kept on this Mac; the first start
// only marks what is already there as seen. Before 5 Oct 2026 it was only for the task clicked in this window, forgot a run whose Notion page had no Result yet, and
// then fell back to raw chat text.
const SEEN_KEY = 'actionsResultSeen';
const SHOWN_KEY = 'actionsResultShown';   // the ids shown since that first start (renderer/result-seen.js)
const seenResult = () => { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } };
const shownResults = () => { try { return JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]').filter(Number.isFinite); } catch { return []; } };
const markResultSeen = id => { try { if (!seenResult()) localStorage.setItem(SEEN_KEY, String(id)); localStorage.setItem(SHOWN_KEY, JSON.stringify(withShown(shownResults(), id))); } catch { /* private window: it shows again after a reload */ } };
const waitingForResult = new Set();   // run ids whose Notion page is being read for the result
export function showAwaitedResult(runs, {opening = false} = {}) {
  const newest = runs.find(r => r.endedAt && !r.live && KIND[kindOf(r)]);
  if (!seenResult()) { markResultSeen(newest ? newest.id : 1); return; }   // first start: what is there already is not news (1: no run yet, every later one is)
  if (!newest) return;
  const run = unseenRun(runs, {base: seenResult(), shown: shownResults()}, r => KIND[kindOf(r)]);
  if (!run || waitingForResult.has(run.id)) return;
  const onActions = opening || !document.querySelector('.view[data-view="actions"]').hidden;   // opening: drawn before the page is shown (prepareActions)
  if (!onActions && $('activity-panel').hidden) return;   // shown when the Actions page is opened
  const kind = KIND[kindOf(run)];
  const show = message => {
    if (!$('activity-panel').hidden) {
      runResults.set(run.id, message || capital(outcome(run)));  // shown under the run in Recent activity
      shared.selectedRun = run.id;
      markResultSeen(run.id);
      renderActivity(lastActivity);
      return;
    }
    // The same card as in Recent activity (counts, top matches, the report); a run without one gets its outcome in the same frame, never raw text.
    const draw = cardFor(run, message) || (target => target.replaceChildren(el('p', 'run-card-note', message ? plainMessage(message) : capital(outcome(run)))));
    showActionsResult(run, kind, draw);
    markResultSeen(run.id);
  };
  if (run.message || !run.pageId) { show(run.message); return; }
  // A run recorded on this Mac has no message when it was sent to Telegram: it is on its Notion page, written a moment after the run ends.
  waitingForResult.add(run.id);
  // On Actions, the card takes its place at once, as skeleton bars, and fills in when the page is read: appearing seconds later at the top, it pushed the task grid
  // down while a person was about to press a task (#286).
  if ($('activity-panel').hidden) showActionsResult(run, kind, renderCardSkeleton);
  const read = (tries = 0) => window.pilot.runDetail(run.pageId).then(detail => detail?.message || tries >= 6 ? detail?.message : new Promise(resolve => setTimeout(resolve, 4000)).then(() => read(tries + 1)))
    .catch(() => null);
  read().then(message => { waitingForResult.delete(run.id); show(message || null); });
}
// The status bar's last finished state, kept on this Mac: shown the moment the window opens, instead of
// "No search yet" until the run history has been read (from Notion). A running state is never kept.
const STATUS_KEPT = 'statusBar';
export function keepStatusBar() {
  const kept = {state: $('activity').dataset.state, title: $('activity-title').textContent,
    step: $('activity-step').textContent, meta: $('activity-meta').textContent};
  try { localStorage.setItem(STATUS_KEPT, JSON.stringify(kept)); } catch {}
}
export function showKeptStatusBar() {
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(STATUS_KEPT) || 'null'); } catch {}
  if (!kept?.title || lastActivity) return;
  $('activity').dataset.state = kept.state || 'idle';
  $('activity-title').textContent = kept.title;
  $('activity-step').textContent = kept.step;
  $('activity-meta').textContent = kept.meta;
}
// Recent activity kept on this Mac: until the run history has been read from Notion (the runs of GitHub and Telegram
// live there), the panel shows the list from last time, with this Mac's newer runs on top, instead of an empty panel.
const ACTIVITY_KEPT = 'recentActivity';
export function withKept(data) {
  if (data.historyLoaded) {
    try { localStorage.setItem(ACTIVITY_KEPT, JSON.stringify(data.runs.slice(0, 20))); } catch {}
    return data;
  }
  let kept = [];
  try { kept = JSON.parse(localStorage.getItem(ACTIVITY_KEPT) || '[]'); } catch {}
  if (!kept.length) return data;
  const byId = new Map(kept.map(run => [run.id, run]));
  for (const run of data.runs) byId.set(run.id, run);  // this Mac's copy is the newer one
  const runs = [...byId.values()].sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
  return {...data, runs};
}
// Recent activity lists every run that took time or AI money, scheduled or started by you; the ones you started
// (a Log box entry, an interview prep kit, a Check now) carry a "By you" tag, and every row shows its AI cost.
export const byYou = run => run.trigger === 'you' && !run.live && !run.waiting;
// How many finished runs the list shows at once; "View more" adds another page and the list scrolls. The app reads
// the newest 25 from Notion, so that is as far as it goes without asking Notion again.
