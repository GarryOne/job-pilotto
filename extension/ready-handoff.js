// Ready to send's "Open in my browser" in the extension (spec docs/superpowers/specs/2026-10-17-ready-to-send.md, PR 5b; owner 18 Oct 2026: carry the
// cookies, the normal fill takes over): a tab the app opened for a job asks the app once, while it first loads, for the night's hand-off
// (desktop/lib/ready-handoff.js). With one, the page's cookies are set, the tab loads the page the night ended on (keeping its fill mark, so it stays
// the app's session), and when that page is loaded the night's values are put back; then the normal fill runs for whatever is left. Never a
// password (the server never takes one), never a file (the normal fill uploads them), never Submit. Guard: desktop/test/extension-ready-handoff.test.js.

const key = tabId => `handoff:${tabId}`;

// The page side, run in the tab: the origin's storage, then each field by its id (else its name, when that name is one field's), with the events a
// form listens for. Checkboxes and radios only by id: a name is shared by a group. Returns how many fields were put back.
export function restoreInPage(handoff) {
  const put = (area, items) => { for (const [name, value] of Object.entries(items || {})) { try { if (area.getItem(name) === null) area.setItem(name, value); } catch { /* storage refused */ } } };
  put(localStorage, handoff.localStorage); put(sessionStorage, handoff.sessionStorage);
  let restored = 0;
  for (const field of handoff.snapshot?.fields || []) {
    if (!field || field.type === 'hidden' || field.type === 'password' || field.value === '' || field.value == null) continue;
    let element = field.id ? document.getElementById(field.id) : null;
    if (!element && field.name && !['checkbox', 'radio'].includes(field.type)) {
      const named = document.getElementsByName(field.name);
      element = named.length === 1 ? named[0] : null;
    }
    if (!element || element.type === 'password' || element.type === 'file') continue;
    if (['checkbox', 'radio'].includes(element.type)) {
      if (element.checked === !!field.value) continue;
      element.checked = !!field.value;
    } else {
      if (element.value) continue;   // something there already: the page's own, or a person's
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
      if (setter) setter.call(element, String(field.value)); else element.value = String(field.value);
    }
    element.dispatchEvent(new Event('input', {bubbles: true}));
    element.dispatchEvent(new Event('change', {bubbles: true}));
    restored++;
  }
  return restored;
}

// deps: {chrome, api(path, init), sessionGet(key), move(tabId, url): tabs.js moveTab (so the move counts as the extension's own, never an outside link), decide(what, fields)}.
export function createReadyHandoff({chrome, api, sessionGet, move, decide = () => {}}) {
  // While a marked tab first loads: ask once. -> true when the tab was sent on to the night's page (the caller stops; that load comes back here).
  async function takeHandoff(tabId, url, status) {
    if (status !== 'loading') return false;
    const state = (await sessionGet(key(tabId)))[key(tabId)];
    if (state) return false;   // asked already (nothing, or the restore waits for the page)
    await chrome.storage.session.set({[key(tabId)]: {step: 'asked'}});
    const answer = await api('/extension/ready-handoff', {method: 'POST', body: JSON.stringify({url})}).catch(() => null);
    const handoff = answer?.handoff;
    if (!handoff?.url) return false;
    let set = 0;
    for (const cookie of handoff.cookies || []) if (await chrome.cookies.set(cookie).catch(() => null)) set++;
    await chrome.storage.session.set({[key(tabId)]: {step: 'restore', handoff}});
    const mark = String(url).includes('#') ? `#${String(url).split('#').slice(1).join('#')}` : '';
    decide('ready', 'open in my browser: the night\'s page', {cookies: set, fields: handoff.snapshot?.fields?.length || 0});
    await move(tabId, `${handoff.url.split('#')[0]}${mark}`);
    return true;
  }
  // When the page is loaded, before the normal fill: put the night's values back, once.
  async function restoreHandoff(tabId) {
    const state = (await sessionGet(key(tabId)))[key(tabId)];
    if (state?.step !== 'restore') return 0;
    await chrome.storage.session.set({[key(tabId)]: {step: 'done'}});
    const [result] = await chrome.scripting.executeScript({target: {tabId}, func: restoreInPage, args: [state.handoff]}).catch(() => []);
    const restored = Number(result?.result) || 0;
    decide('ready', 'open in my browser: the night\'s values back', {restored, of: state.handoff.snapshot?.fields?.length || 0});
    return restored;
  }
  return {takeHandoff, restoreHandoff};
}
