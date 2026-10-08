// Which sites hold an account made for which email (owner, 8 Oct 2026): kept in settings.siteAccounts as {host: {email, state, at}}, never a password.
// state: 'pending' = the extension pressed the account button and the confirmation mail is awaited; 'confirmed' = the mail's link was opened (or a sign-in
// worked). The extension asks the app for the MODE on a sign-in or sign-up page: 'sign-in' only for a confirmed account of this very email, 'confirm' while
// one is pending (nothing is pressed: the app waits for the mail), else 'sign-up' ('creating': the password was just made for a sign-up under way, no account yet). Guard: test/site-accounts.test.js.
const key = host => String(host || '').trim().toLowerCase();

// itemEmail: the email recorded on this host's password item in Settings → Credentials (an account made earlier, e.g. by Apply with Claude): the same address means we have an account.
export function modeOf(accounts, host, email, itemEmail = '') {
  const kept = accounts?.[key(host)];
  if (!kept && email && itemEmail && itemEmail.toLowerCase() === String(email).toLowerCase()) return 'sign-in';
  if (!kept || !email || String(kept.email || '').toLowerCase() !== String(email).toLowerCase()) return 'sign-up';
  if (kept.state === 'creating') return 'sign-up';   // the app made this host's password for the sign-up now under way: not an account yet (Manor, 8 Oct 2026: the next page flipped to sign-in)
  return kept.state === 'confirmed' ? 'sign-in' : 'confirm';
}

// A new settings.siteAccounts with this host's account recorded (state 'pending' unless given); the other hosts are untouched.
export function record(accounts, host, email, state = 'pending', now = Date.now()) {
  return {...(accounts || {}), [key(host)]: {email: String(email || '').toLowerCase(), state, at: new Date(now).toISOString()}};
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
export function withAccounts(rows, accounts) {
  const known = new Set();
  const merged = (rows || []).map(row => {
    const kept = accounts?.[key(row.host)];
    if (!kept) return row;
    known.add(key(row.host));
    return {...row, email: row.email || kept.email, state: kept.state, accountAt: kept.at, ...(row.email && kept.email && row.email.toLowerCase() !== kept.email ? {email: kept.email} : {})};
  });
  for (const [host, kept] of Object.entries(accounts || {})) if (!known.has(host)) merged.push({host, email: kept.email, job: '', created: kept.at, state: kept.state, accountAt: kept.at});
  return merged;
}
