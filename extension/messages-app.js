// The extension worker's messages from the page: the site password for a sign-in page and the form review relay to the app (moved out of background.js, 8 Oct 2026).
// A group of createXMessages: each returns a function that answers the messages it owns and returns undefined for any other. A FLOW FILE (docs/flows/applying.md).
// Guards: the credentials and review tests in desktop/test and the matrix (npm run flows).
import {api} from './flow.js';
import {accountStep} from './account-step.js';
import {roleOf} from './account.js';
import {sessionGet} from './tab-memory.js';
import {settings} from './flow.js';

export function createAppMessages(ctx) {
  const {bootId, jobOf} = ctx;
  return function messages_app(message, sender, reply) {
    // A sign-in or sign-up page in a tab the app opened: its empty password boxes are filled from the Keychain (owner, 8 Oct 2026),
    // as a browser's password manager would. The site is Chrome's own tab address, not the page's word; the value goes into the
    // boxes only, never back to the page's scripts or the panel.
    if (message?.type === 'sitePassword' && sender.tab) {
      accountStep(sender.tab, sender.frameId).then(reply, () => reply({filled: 0}));
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
