// Which sites hold an account made for which email (owner, 8 Oct 2026): kept in settings.siteAccounts as {host: {email, state, at}}, never a password.
// state: 'pending' = the extension pressed the account button and the confirmation mail is awaited; 'confirmed' = the mail's link was opened (or a sign-in
// worked). The extension asks the app for the MODE on a sign-in or sign-up page: 'sign-in' only for a confirmed account of this very email, 'confirm' while
// one is pending (nothing is pressed: the app waits for the mail), else 'sign-up' ('creating': the password was just made for a sign-up under way, no account yet). Guard: test/site-accounts.test.js.
const key = host => String(host || '').trim().toLowerCase();

// itemEmail: the email recorded on this host's password item in Settings → Credentials (an account made earlier, e.g. by Apply with Claude): the same address means we may have an account. hasItem: the host has an item at all (owner, 9 Oct 2026: "it should be in Settings → Credentials, otherwise create an account"): sign in first.
export function modeOf(accounts, host, email, itemEmail = '', hasItem = false, company = '') {
  const kept = accounts?.[key(host)], mine = String(email || '').toLowerCase(), name = employerName(company);
  if (!mine) return 'sign-up';   // no email of ours to sign in with
  const sameEmail = !!kept && String(kept.email || '').toLowerCase() === mine;
  // One host can serve several employers (SuccessFactors: Coop, Migros), each with its own account: the employer's own state when we have one for it, else the host's.
  const state = sameEmail ? (name && kept.employers ? kept.employers[name] : kept.state) : null;
  if (state) {
    if (state === 'creating' || state === 'refused') return 'sign-up';   // 'creating': the password was just made for a sign-up under way; 'refused': a sign-in with this email was refused here, so there is no account yet
    return state === 'confirmed' ? 'sign-in' : 'confirm';
  }
  if (kept && !sameEmail) return 'sign-up';   // a record for another email
  // No record of ours (for this employer): a Credentials item for this host may mean an account. The same email, or no email recorded: sign in FIRST (once; a refusal says 'refused' and the extension signs up). Another email: not ours.
  if (itemEmail) return itemEmail.toLowerCase() === mine ? 'sign-in' : 'sign-up';
  return hasItem ? 'sign-in' : 'sign-up';
}

// A new settings.siteAccounts with this host's account recorded (state 'pending' unless given); the other hosts are untouched.
// employer: the job's company, so one host that serves several employers keeps one state each (employers: {name: state}, the six latest).
// settings.siteAccounts without this host (its password was deleted in Settings → Credentials: the app no longer claims an account there).
export function withoutHost(accounts, host) { const kept = {...(accounts || {})}; delete kept[key(host)]; return kept; }
export const employerName = company => String(company || '').replace(/\s+/g, ' ').trim().slice(0, 40);
export function record(accounts, host, email, state = 'pending', now = Date.now(), employer = '') {
  const before = accounts?.[key(host)], mail = String(email || '').toLowerCase(), name = employerName(employer);
  const employers = Object.fromEntries(Object.entries(before && String(before.email || '').toLowerCase() === mail ? before.employers || {} : {}).filter(([kept]) => kept !== name));
  if (name) employers[name] = state;
  const latest = Object.entries(employers).slice(-6);
  return {...(accounts || {}), [key(host)]: {email: mail, state, at: new Date(now).toISOString(), ...(latest.length ? {employers: Object.fromEntries(latest)} : {})}};
}

// How far the extension goes on a sign-up page (owner, 8 Oct 2026): 'full' = it also accepts the account's consent (a checkbox, or a link and the dialog's accept button, as the
// AI names them) and presses the account button; 'assist' = it fills, and leaves the consent and the button to the person. Only the ACCOUNT's steps, never an application's Submit.
// Settings → Automation has the switch (settings.accountAutomation). The default is assist (9 Oct 2026, before the app went to others): the extension fills, the person accepts the consent and presses the account button. The owner's own app is set to full in Settings.
export const DEFAULT_AUTOMATION = 'assist';
// The settings as the window draws them: the account automation resolved to what the extension will do, whatever was never saved (every settings answer to the window goes through this, so a switch never shows ON for a setting that behaves as assist).
export const forWindow = settings => ({...settings, accountAutomation: automationOf(settings)});
export const automationOf = settings => (settings?.accountAutomation === 'assist' ? 'assist' : settings?.accountAutomation === 'full' ? 'full' : DEFAULT_AUTOMATION);

// Settings → Credentials (lib/credentials.js lists the Keychain's password items, which know a host and sometimes an email): the account we made on a host, from settings.siteAccounts, fills
// the email the item lacks and says where it stands. An account in the record whose host has no password item is listed too (its password was removed: Show finds none).
// The employers an account was used for, for the Credentials row: [{name, state}], the latest last.
const employersOf = kept => Object.entries(kept?.employers || {}).map(([name, state]) => ({name, state}));
export function withAccounts(rows, accounts) {
  const known = new Set();
  const merged = (rows || []).map(row => {
    const kept = accounts?.[key(row.host)];
    if (!kept) return row;
    known.add(key(row.host));
    return {...row, email: row.email || kept.email, state: kept.state, accountAt: kept.at, employers: employersOf(kept), ...(row.email && kept.email && row.email.toLowerCase() !== kept.email ? {email: kept.email} : {})};
  });
  for (const [host, kept] of Object.entries(accounts || {})) if (!known.has(host)) merged.push({host, email: kept.email, job: '', created: kept.at, state: kept.state, accountAt: kept.at, employers: employersOf(kept)});
  return merged;
}

// The companies a credential row's account serves (owner, 9 Oct 2026: "show the company names for which this account works", e.g. Migros, Coop on one
// SuccessFactors host): the employers recorded with the account, plus the company of every application whose form tab is on that host now (a session's
// review state). Names only, no duplicates, the recorded ones first. states: [{id, url}] (lib/review.js allStates); sessions: [{id, company}] (lib/terminals.js list).
export function withCompanies(rows, states = [], sessions = []) {
  const hostOf = url => { try { return new URL(String(url)).hostname.toLowerCase(); } catch { return ''; } };
  const companyOf = new Map(sessions.map(session => [session.id, employerName(session.company)]));
  return (rows || []).map(row => {
    const names = (row.employers || []).map(item => item.name);
    for (const state of states) if (hostOf(state.url) === key(row.host) && companyOf.get(state.id)) names.push(companyOf.get(state.id));
    return {...row, companies: [...new Set(names.filter(Boolean))]};
  });
}
