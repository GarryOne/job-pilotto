// The extension worker's messages from the page: the site password for a sign-in page and the form review relay to the app (moved out of background.js, 8 Oct 2026).
// A group of createXMessages: each returns a function that answers the messages it owns and returns undefined for any other. A FLOW FILE (docs/flows/applying.md).
// Guards: the credentials and review tests in desktop/test and the matrix (npm run flows).
import {api} from './flow.js';
import {decide} from './log.js';
import {roleOf} from './account.js';
import {sessionGet} from './tab-memory.js';
import {settings} from './flow.js';
import {tabArmed} from './tab-pages.js';

export function createAppMessages(ctx) {
  const {bootId, jobOf} = ctx;
  return function messages_app(message, sender, reply) {
    // A sign-in or sign-up page in a tab the app opened: its empty password boxes are filled from the Keychain (owner, 8 Oct 2026),
    // as a browser's password manager would. The site is Chrome's own tab address, not the page's word; the value goes into the
    // boxes only, never back to the page's scripts or the panel.
    if (message?.type === 'sitePassword' && sender.tab) {
      (async () => {
        const key = `armed:${sender.tab.id}`;
        const stored = await sessionGet(key);
        if (!tabArmed({url: sender.tab.url, armed: stored[key]})) return {filled: 0};
        const host = new URL(sender.tab.url).hostname;
        const config = await settings();
        if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return {filled: 0};   // your own Worker: no Keychain
        const answer = await api(config, '/extension/site-password', {method: 'POST', body: JSON.stringify({host})});
        if (!answer?.ok || !answer.password) return {filled: 0};
        const [result] = await chrome.scripting.executeScript({target: {tabId: sender.tab.id, frameIds: [sender.frameId ?? 0]}, args: [answer.password], func: password => {
          let filled = 0;
          for (const box of document.querySelectorAll('input[type=password]')) {
            if (box.disabled || box.readOnly || box.value || !box.getClientRects().length) continue;
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, password);   // React/Vue see the change too
            box.dispatchEvent(new Event('input', {bubbles: true}));
            box.dispatchEvent(new Event('change', {bubbles: true}));
            box.setAttribute('data-jobpilotto-filled', '1');
            filled++;
          }
          return filled;
        }});
        decide('fill', 'password filled from the Keychain', {host, boxes: result?.result || 0});
        return {filled: result?.result || 0};
      })().then(reply, () => reply({filled: 0}));
      return true;
    }
    if (message?.type === 'review' && sender.tab) {
      (async () => {
        const config = await settings();
        if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return {matched: null};  // your own Worker: no app
        // The session this tab belongs to travels with it (next pages, tabs it opens): the app uses it instead of guessing.
        const key = `session:${sender.tab.id}`, carried = (await sessionGet(key))[key] || '';
        const answer = await api(config, '/extension/review', {method: 'POST', body: JSON.stringify({...(message.payload || {}), tab: sender.tab.id, boot: await bootId(), job: await jobOf(sender.tab), session: carried,
          role: await roleOf(sender.tab.id, sender.tab.url)})});   // the page type by the one rule (an account page never counts as the form's progress)
        if (answer?.matched && answer.matched !== carried) await chrome.storage.session.set({[key]: answer.matched});
        return answer;
      })().then(reply, () => reply({matched: null}));
      return true;  // the reply comes later
    }
    return undefined;   // not one of this group's messages: the next group looks
  };
}
