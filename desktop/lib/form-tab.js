// "Open filled form" on the session page: the form Claude filled is a tab in the user's Chrome; this finds that
// tab and switches Chrome to it (Mac, through Chrome's scripting; macOS asks once to let Job Pilotto control
// Chrome). Without Chrome, the permission, or a matching tab, the posting opens instead.
import {execFile} from 'node:child_process';

// Hosts of application forms (applicant tracking systems): a tab there naming the company is the form.
export const ATS = /greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|workable\.com|recruitee\.com|personio\.|teamtailor\.com|bamboohr\.com|jobvite\.com|icims\.com|join\.com|rippling\.com/i;
const slug = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const bare = url => String(url || '').replace(/[?#].*$/, '').replace(/\/+$/, '');

// How likely a tab (or page) is this job's form, 0 = not: the posting itself, a tab carrying the posting's job ID,
// an application-form host naming the company, the company in the title, then the posting's site.
export function scoreTab(tab, {url, company}) {
  const posting = bare(url);
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* no URL */ }
  const ids = String(url || '').match(/\d{5,}/g) || [];
  const name = slug(company);
  const tabUrl = String(tab.url || ''), words = slug(`${tabUrl} ${tab.title}`);
  let tabHost = '';
  try { tabHost = new URL(tabUrl).hostname.replace(/^www\./, ''); } catch { return 0; }
  let score = 0;
  if (posting && bare(tabUrl).startsWith(posting)) score = 100;
  else if (ids.some(id => tabUrl.includes(id))) score = 80;
  else if (name.length > 1 && ATS.test(tabHost) && words.includes(name)) score = 70;
  else if (name.length > 1 && slug(tab.title).includes(name)) score = 50;
  else if (host && tabHost === host) score = 30;
  if (score && /apply|application|form/i.test(tabUrl)) score += 5;
  return score;
}

// The tab to act on for this job, only when the match is confident (never someone else's tab, never a close or a
// reload on a guess): the job ID in its URL, or the posting itself.
export function reloadTarget(tabs, target, min = 70) {
  const tab = pickTab(tabs, target);
  return tab && scoreTab(tab, target) >= min ? tab : null;
}

// A tab the app armed (the fill mark) that no address or name matches to a job, on a host that isn't a job board: an agency's
// own form behind the posting. Only when it is the only one: with two, nothing says which is whose.
const hostOf = url => { try { return new URL(String(url)).hostname; } catch { return ''; } };
export function markedTab(tabs) {
  const marked = (tabs || []).filter(tab => String(tab.url || '').includes('jobpilotto-fill') && !ATS.test(hostOf(tab.url)));
  return marked.length === 1 ? marked[0] : null;
}
// The tab to bring forward for a job: the page this session's own reports came from (when still open), else its best match
// when that tab is one the app armed (the form itself), else the lone armed agency form (the plain posting tab matches a job
// best, but it is not the form), else the best match. Tabs another session's reports came from (`claimed`) are never taken:
// 1 Oct 2026, a card whose own tab had no fill mark opened another card's agency form.
export function chooseTab(tabs, target, {own = '', claimed = []} = {}) {
  const key = url => String(url || '').split(/[?#]/)[0].replace(/\/+$/, '');
  const mine = own && tabs.find(tab => key(tab.url) === key(own));
  if (mine) return mine;
  const taken = new Set(claimed.map(key).filter(Boolean));
  const free = tabs.filter(tab => !taken.has(key(tab.url)));
  const best = pickTab(free, target);
  if (best && String(best.url || '').includes('jobpilotto-fill')) return best;
  return markedTab(free) || best;
}

// One list of open form tabs from both sources: the extension's report (any browser, URLs only) and Chrome's own
// scripting (one instance, with titles). A URL seen in both keeps the scripting entry, which carries the title the
// matcher likes; the extension is the source that is always right about *what is open*.
export function mergeTabs(reported = [], scripted = []) {
  const key = url => String(url || '').split('#')[0].replace(/\/+$/, '');
  const byUrl = new Map();
  for (const url of reported) if (url) byUrl.set(key(url), {url: String(url)});
  for (const tab of scripted) if (tab?.url) byUrl.set(key(tab.url), tab);
  return [...byUrl.values()];
}

// The tab most likely to be this job's form, or null.
export function pickTab(tabs, target) {
  let best = null, bestScore = 0;
  for (const tab of tabs) {
    const score = scoreTab(tab, target);
    if (score >= bestScore && score > 0) { best = tab; bestScore = score; }  // ties: the later tab (opened last)
  }
  return best;
}

const jxa = script => new Promise((resolve, reject) =>
  execFile('osascript', ['-l', 'JavaScript', '-e', script], {timeout: 8000}, (error, stdout) => (error ? reject(error) : resolve(stdout.trim()))));

const LIST = `const chrome = Application('Google Chrome');
JSON.stringify(chrome.running() ? chrome.windows().flatMap(w => w.tabs().map((t, i) => ({win: w.id(), index: i + 1, url: t.url(), title: t.title()}))) : null)`;
const focus = ({win, index}) => `const chrome = Application('Google Chrome');
const w = chrome.windows.byId(${Number(win)}); w.activeTabIndex = ${Number(index)}; w.index = 1; chrome.activate();`;

// Which sessions still have their form open in a tab: each tab goes to one session at most, the strongest match first
// (its job ID beats a company name, so two applications at one company get their own tabs). Returns the session ids.
export function withOpenForm(sessions, tabs, minScore = 50) {
  const pairs = [];
  for (const session of sessions) for (const [index, tab] of tabs.entries()) {
    const score = scoreTab(tab, {url: session.url, company: session.company});
    if (score >= minScore) pairs.push({id: session.id, index, score});
  }
  pairs.sort((a, b) => b.score - a.score);
  const taken = new Set(), found = new Set();
  for (const {id, index} of pairs) if (!found.has(id) && !taken.has(index)) { found.add(id); taken.add(index); }
  return found;
}
// Chrome's open tabs ([{url, title}]), [] without Chrome, permission or a Mac.
export async function listTabs(platform = process.platform) {
  if (platform !== 'darwin') return [];
  try { return JSON.parse(await jxa(LIST)) || []; } catch { return []; }
}

// Closes this job's form tab (the application was cancelled) with the Mac's scripting, when the extension didn't.
// Returns true when a tab was closed.
export async function closeFormTab({url, company}, platform = process.platform) {
  if (platform !== 'darwin') return false;
  try {
    const tabs = JSON.parse(await jxa(LIST)) || [];
    const tab = reloadTarget(tabs, {url, company});
    if (!tab) return false;
    await jxa(`Application('Google Chrome').windows.byId(${Number(tab.win)}).tabs[${Number(tab.index) - 1}].close()`);
    return true;
  } catch { return false; }
}

// Reloads this job's form tab: the repair for a tab whose page still holds a panel from an older extension — after an
// uninstall/reinstall the page's script is orphaned and can't answer the app, and only a fresh page load brings the
// extension back onto it. Chrome's own reload (its scripting dictionary: "reload tab"). Says why when it can't:
// 'reloaded', 'permission' (macOS won't let Job Pilotto control Chrome), 'no-tab', 'no-window' (Chrome is running but
// answered with no windows: another Chrome instance — an automation's headless one — is holding the scripting
// connection, so the window the user works in is not reachable this way), 'no-chrome', 'manual' (this isn't a Mac:
// Chrome's scripting is macOS-only, so reloading the tab is the user's to do), 'other'.
export async function reloadFormTab({url, company}, platform = process.platform) {
  if (platform !== 'darwin') return 'manual';
  let tabs, tab;
  try {
    tabs = JSON.parse(await jxa(LIST));
    if (!tabs) return 'no-chrome';
    if (!tabs.length) return 'no-window';
    tab = reloadTarget(tabs, {url, company});
    if (!tab) return 'no-tab';
    await jxa(`Application('Google Chrome').windows.byId(${Number(tab.win)}).tabs[${Number(tab.index) - 1}].reload()`);
    return 'reloaded';
  } catch { return tabs === undefined ? 'permission' : 'other'; }
}

// The tab's own address with the fill mark (the page may differ from the posting: an embedded form), or '' if it has it.
export const markedUrl = url => (/^https?:/.test(url || '') && !String(url).includes('#jobpilotto-fill') ? `${String(url).split('#')[0]}#jobpilotto-fill` : '');

// Switches Chrome to the form's tab; returns how it went: 'tab', 'chrome' (no matching tab) or 'posting'. The posting
// opens only when Chrome isn't running: on most job sites the posting's link IS the form, so opening it while Chrome
// runs would add a second, empty copy of the form next to the filled one.
// `confident`: act only on a sure match (an armed tab, or the job's ID or address in it); otherwise do nothing and say 'none'.
export async function openFormTab({url, company}, openExternal, {confident = false, own = '', claimed = []} = {}) {
  if (process.platform !== 'darwin') { await openExternal(url); return 'posting'; }
  try {
    const tabs = JSON.parse(await jxa(LIST));
    if (!tabs) { await openExternal(url); return 'posting'; }
    const tab = chooseTab(tabs, {url, company}, {own, claimed});
    const isOwn = !!(tab && own && String(tab.url || '').split(/[?#]/)[0].replace(/\/+$/, '') === String(own).split(/[?#]/)[0].replace(/\/+$/, ''));
    if (confident && !(tab && (isOwn || String(tab.url || '').includes('jobpilotto-fill') || scoreTab(tab, {url, company}) >= 70))) return 'none';
    if (tab) {
      // A tab without the fill mark is one the extension never joined (Claude opened it): add the mark so it does.
      const marked = markedUrl(tab.url);
      if (marked) await jxa(`Application('Google Chrome').windows.byId(${Number(tab.win)}).tabs[${Number(tab.index) - 1}].url = ${JSON.stringify(marked)}`);
      await jxa(focus(tab));
      return 'tab';
    }
    await jxa("Application('Google Chrome').activate()");
    return 'chrome';
  } catch {
    // No permission to control Chrome: at least bring it forward (never a new copy of the form).
    try { await jxa("Application('Google Chrome').activate()"); return 'chrome'; } catch { return 'chrome'; }
  }
}
