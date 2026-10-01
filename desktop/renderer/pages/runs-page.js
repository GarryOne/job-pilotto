// Status card and the Actions page.
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {shared} from './shared.js';
import {KIND, capital, clockTime, hhmm, kindOf, lastActivity, openActivity, outcome, renderActivity} from './activity.js';
import {$, runWhen, show} from './core.js';
import {openView} from './nav.js';

// Status: what's running, the last and next search, the last and next Gmail check, as a small card.
export async function showStatusCard() {
  const data = await window.pilot.runs();
  const {running, runs, nextSearchAt, nextMailAt} = data;
  const lastSearch = runs.find(run => kindOf(run) === 'search'), lastMail = runs.find(run => kindOf(run) === 'mail');
  const when = at => (at <= Date.now() ? 'due now' : `${new Date(at).toLocaleDateString([], {weekday: 'short'})} ${hhmm(at)}`);
  const rows = [
    running && ['▶️', 'Running now', `${KIND[kindOf(running)].icon} ${KIND[kindOf(running)].name} · ${running.step || 'starting'}`],
    ['🔎', 'Last search', lastSearch ? `${clockTime(lastSearch.endedAt || lastSearch.startedAt)} · ${capital(outcome(lastSearch))}` : 'none yet'],
    ['⏭', 'Next search', nextSearchAt ? when(nextSearchAt) : 'only when you ask'],
    ['📧', 'Last Gmail check', lastMail ? `${clockTime(lastMail.endedAt || lastMail.startedAt)} · ${capital(outcome(lastMail))}` : 'none yet'],
    ['⏭', 'Next Gmail check', nextMailAt ? when(nextMailAt) : 'off'],
  ].filter(Boolean);
  const card = $('status-card');
  card.replaceChildren(el('h2', '', '🩺 Status'), ...rows.map(([glyph, label, value]) => {
    const row = el('div', 'status-row');
    row.append(el('span', 'status-glyph', glyph), el('span', 'muted', label), el('b', '', value));
    return row;
  }));
  const more = Object.assign(el('a', 'link small', 'See Recent activity →'), {href: '#'});
  more.addEventListener('click', event => { event.preventDefault(); openActivity(true); });
  card.append(more);
  show(card);
  show($('command-answer'), false);
  card.scrollIntoView({behavior: 'smooth', block: 'nearest'});
}

// Actions page: the live banner (what runs now), Recent runs, and Telegram's state. Fed by the activity data.
const TASK_ICON = {search: 'search', mail: 'mail', insight: 'chart', weekly: 'file', today: 'send', scout: 'building'};
const TASK_TITLE = {search: 'Search for new jobs', mail: 'Gmail & Calendar check', insight: 'Insight', weekly: 'Weekly report',
  today: "Today's matches", scout: 'Find new employers'};
export function renderActionsPage(data) {
  if (!data) return;
  const {running, runs = []} = data;
  const connected = !!(shared.state.settings.telegramChatId || shared.state.settings.telegramCloud);
  $('actions-telegram').replaceChildren(el('span', `dot ${connected ? 'is-on' : ''}`), document.createTextNode(connected ? 'Telegram connected' : 'Telegram not connected'));
  show($('run-banner'), !!running);
  if (running) {
    const kind = kindOf(running);
    $('run-banner-title').textContent = `${TASK_TITLE[kind] || KIND[kind]?.name || 'A task'} is running`;
    $('run-banner-step').textContent = `Started ${new Date(running.startedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})} · ${running.step || 'starting'}`;
  }
  const rows = runs.slice(0, 5).map(run => {
    const kind = kindOf(run);
    const [label, tone] = run.ok && !run.off ? ['Completed', 'good'] : ['Needs a look', 'bad'];
    const li = el('li', 'runs-row');
    const tile = el('span', 'task-tile small');
    tile.append(icon(TASK_ICON[kind] || 'pulse'));
    li.append(tile, el('b', '', KIND[kind]?.name || 'Task'), pill(label, tone), el('span', 'muted', runWhen(run.endedAt || run.startedAt)),
      el('span', 'muted runs-result', capital(outcome(run))), el('span', 'runs-go', '›'));
    li.addEventListener('click', () => { shared.selectedRun = run.id; openActivity(true); renderActivity(lastActivity); });
    return li;
  });
  $('runs-table').replaceChildren(...(rows.length ? rows : [el('li', 'muted runs-empty', 'Nothing has run yet. Press Run on a task above.')]));
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  $('run-banner-view').addEventListener('click', () => openActivity(true));
  $('actions-result-close').addEventListener('click', () => show($('actions-result'), false));
  $('runs-all').addEventListener('click', event => { event.preventDefault(); openActivity(true); });
  $('actions-automation').addEventListener('click', event => {
    event.preventDefault();
    openView('settings');
    document.getElementById('setting-schedule')?.scrollIntoView({behavior: 'smooth', block: 'start'});
  });
}
