// "Open filled form" on the session page: the form Claude filled is a tab in the user's Chrome; this switches Chrome to it (Mac, through Chrome's
// scripting; macOS asks once to let Job Pilotto control Chrome). WHICH tab is the session's is decided in one place, lib/session-tab.js (its bound tab id,
// else the session id in its address); this file only drives Chrome. No tab owned: 'none', and nothing is opened or taken instead.
import {execFile} from 'node:child_process';
import {isTwin} from './twin.js';
import {tabOfSession} from './session-tab.js';

// Hosts of application forms (applicant tracking systems): also how control-events.js names a site's kind.
export const ATS = /greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|workable\.com|recruitee\.com|personio\.|teamtailor\.com|bamboohr\.com|jobvite\.com|icims\.com|join\.com|rippling\.com/i;
const bare = url => String(url || '').replace(/[?#].*$/, '').replace(/\/+$/, '');

const jxa = script => new Promise((resolve, reject) => (isTwin() ? reject(new Error('a twin never drives the owner\'s Chrome')) :   // lib/twin.js
  execFile('osascript', ['-l', 'JavaScript', '-e', script], {timeout: 8000}, (error, stdout) => (error ? reject(error) : resolve(stdout.trim())))));

const LIST = `const chrome = Application('Google Chrome');
JSON.stringify(chrome.running() ? chrome.windows().flatMap(w => w.tabs().map((t, i) => ({win: w.id(), index: i + 1, id: String(t.id()), url: t.url(), title: t.title()}))) : null)`;
const focus = ({win, index}) => `const chrome = Application('Google Chrome');
const w = chrome.windows.byId(${Number(win)}); w.activeTabIndex = ${Number(index)}; w.index = 1; chrome.activate();`;

// Closes this session's form tab (the application was cancelled) with the Mac's scripting, when the extension didn't. True when a tab was closed.
export async function closeFormTab({id, boundTab = ''}, platform = process.platform) {
  if (platform !== 'darwin') return false;
  try {
    const tab = tabOfSession(id, JSON.parse(await jxa(LIST)) || [], boundTab);
    if (!tab) return false;
    await jxa(`Application('Google Chrome').windows.byId(${Number(tab.win)}).tabs[${Number(tab.index) - 1}].close()`);
    return true;
  } catch { return false; }
}

// Reloads this session's form tab: the repair for a tab whose page still holds a panel from an older extension: after an uninstall/reinstall the
// page's script is orphaned and can't answer the app, and only a fresh page load brings the extension back onto it. Says why when it can't:
// 'reloaded', 'permission' (macOS won't let Job Pilotto control Chrome), 'no-tab', 'no-window' (Chrome runs but answered with no windows: another Chrome
// instance, an automation's headless one, holds the scripting connection), 'no-chrome', 'manual' (not a Mac: the reload is the user's), 'other'.
export async function reloadFormTab({id, boundTab = ''}, platform = process.platform) {
  if (platform !== 'darwin') return 'manual';
  let tabs, tab;
  try {
    tabs = JSON.parse(await jxa(LIST));
    if (!tabs) return 'no-chrome';
    if (!tabs.length) return 'no-window';
    tab = tabOfSession(id, tabs, boundTab);
    if (!tab) return 'no-tab';
    await jxa(`Application('Google Chrome').windows.byId(${Number(tab.win)}).tabs[${Number(tab.index) - 1}].reload()`);
    return 'reloaded';
  } catch { return tabs === undefined ? 'permission' : 'other'; }
}

// Switches Chrome to the session's tab; returns 'tab' or 'none' (no tab is this session's, or Chrome can't be driven: the card offers to reopen the form).
// Never opens, activates or takes another tab: the posting's link is often the form itself, so opening one would add an empty copy next to the filled one.
export async function openFormTab({id, boundTab = ''}) {
  if (isTwin() || process.platform !== 'darwin') return 'none';   // a twin never drives Chrome (lib/twin.js); off a Mac the extension's own panel brings its tab forward
  try {
    const tab = tabOfSession(id, JSON.parse(await jxa(LIST)) || [], boundTab);
    if (!tab) return 'none';
    await jxa(focus(tab));
    return 'tab';
  } catch { return 'none'; }
}
// Chrome's open tabs ([{url, title}]), [] without Chrome, permission or a Mac.
export async function listTabs(platform = process.platform) {
  if (platform !== 'darwin') return [];
  try { return JSON.parse(await jxa(LIST)) || []; } catch { return []; }
}


// Find jobs using your browser' "Show tab" (lib/visits.js showTab): Chrome switched to the tab showing this page (its address without the #mark), true when found.
// The Mac's scripting, as Open filled form; false elsewhere or without the permission, and the caller brings Chrome forward instead.
export async function focusTabAt(url, platform = process.platform) {
  if (platform !== 'darwin' || !url) return false;
  try {
    const want = bare(url);
    const tab = (JSON.parse(await jxa(LIST)) || []).find(item => bare(item.url) === want || bare(item.url).startsWith(want));
    if (!tab) return false;
    await jxa(focus(tab));
    return true;
  } catch { return false; }
}
// Find jobs using your browser' "Open in Chrome": the tab with this id. Chrome numbers a tab the same for its scripting and for extensions (its session id), so the
// id the extension reported for a site's tab finds it whatever address it moved to (owner, 7 Oct 2026: by address it found the wrong tab).
export async function focusTabById(id, platform = process.platform) {
  if (platform !== 'darwin' || id == null) return false;
  try {
    const tab = (JSON.parse(await jxa(LIST)) || []).find(item => item.id === String(id));
    if (!tab) return false;
    await jxa(focus(tab));
    return true;
  } catch { return false; }
}
