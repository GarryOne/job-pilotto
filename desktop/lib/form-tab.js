// "Open filled form" on the session page: the form Claude filled is a tab in the user's Chrome; this finds that
// tab and switches Chrome to it (Mac, through Chrome's scripting; macOS asks once to let Job Pilotto control
// Chrome). Without Chrome, the permission, or a matching tab, the posting opens instead.
import {execFile} from 'node:child_process';

// Hosts of application forms (applicant tracking systems): a tab there naming the company is the form.
const ATS = /greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|workable\.com|recruitee\.com|personio\.|teamtailor\.com|bamboohr\.com|jobvite\.com|icims\.com|join\.com|rippling\.com/i;
const slug = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const bare = url => String(url || '').replace(/[?#].*$/, '').replace(/\/+$/, '');

// The tab most likely to be this job's form, or null: the posting itself, a tab carrying the posting's job ID,
// an application-form host naming the company, the company in the title, then the posting's site.
export function pickTab(tabs, {url, company}) {
  const posting = bare(url);
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* no URL */ }
  const ids = String(url || '').match(/\d{5,}/g) || [];
  const name = slug(company);
  let best = null, bestScore = 0;
  for (const tab of tabs) {
    const tabUrl = String(tab.url || ''), words = slug(`${tabUrl} ${tab.title}`);
    let tabHost = '';
    try { tabHost = new URL(tabUrl).hostname.replace(/^www\./, ''); } catch { continue; }
    let score = 0;
    if (posting && bare(tabUrl).startsWith(posting)) score = 100;
    else if (ids.some(id => tabUrl.includes(id))) score = 80;
    else if (name.length > 1 && ATS.test(tabHost) && words.includes(name)) score = 70;
    else if (name.length > 1 && slug(tab.title).includes(name)) score = 50;
    else if (host && tabHost === host) score = 30;
    if (score && /apply|application|form/i.test(tabUrl)) score += 5;
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

// Switches Chrome to the form's tab; returns how it went: 'tab', 'chrome' (no matching tab) or 'posting'.
export async function openFormTab({url, company}, openExternal) {
  if (process.platform !== 'darwin') { await openExternal(url); return 'posting'; }
  try {
    const tabs = JSON.parse(await jxa(LIST));
    if (!tabs) { await openExternal(url); return 'posting'; }
    const tab = pickTab(tabs, {url, company});
    if (tab) { await jxa(focus(tab)); return 'tab'; }
    await jxa("Application('Google Chrome').activate()");
    return 'chrome';
  } catch {
    // No permission to control Chrome (or no Chrome): at least bring it forward, else open the posting.
    try { await jxa("Application('Google Chrome').activate()"); return 'chrome'; } catch { await openExternal(url); return 'posting'; }
  }
}
