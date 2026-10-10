// Closing a cookie banner, in every frame of a tab (moved out of visit.js, 9 Oct 2026: the apply flow needs it too; Deloitte's application page sat
// behind one). Its words first (free); a banner in another language: the app picks, from the banner's own buttons, the one that refuses what is not
// necessary, else the one that accepts (desktop/lib/server-pages.js pickChoice, by meaning, kept), and that one is pressed. The page-side half is
// closeConsent in visit-page.js. Guards: worker/test (extension consent tests), desktop/e2e/test/consent.test.mjs.
import {api, settings} from './flow.js';
import {closeConsent} from './visit-page.js';
import {findPopup} from './popup-page.js';

// cookiesOnly (the application flow): the free word rule only a box that speaks of cookies or tracking, never a privacy or terms box of the form itself.
const STILL_THERE_MS = 1500;   // a closed banner is gone by then; one still listed after it contradicts the answer that was pressed
const inFrames = async (tabId, args = []) => (await chrome.scripting.executeScript({target: {tabId, allFrames: true}, func: closeConsent, args}).catch(() => []))
  .map(frame => frame?.result);
const popupIn = async (tabId, args) => (await chrome.scripting.executeScript({target: {tabId, allFrames: true}, func: findPopup, args}).catch(() => [])).map(frame => frame?.result);
// Any other popup in the way (a newsletter offer, an alert prompt, a chat invitation, a notice nobody's word list knows): found by structure, closed by the
// button the app's AI names (popup-pick.js), never one that agrees, subscribes or sends; no AI answer, nothing pressed. -> the label pressed, or ''.
const closePopup = async tabId => {
  const seen = (await popupIn(tabId, [{list: true}])).find(found => found?.buttons?.length);
  if (!seen) return '';
  const config = await settings().catch(() => null);
  const choice = config && (await api(config, '/extension/dismiss-popup', {method: 'POST', body: JSON.stringify(seen)}).catch(() => null))?.button;
  if (!choice) return '';
  const pressed = (await popupIn(tabId, [{press: choice}])).find(Boolean) || '';
  // The page contradicts the kept answer when the same popup is still there after its button: the app forgets it (desktop/lib/kept-decisions.js).
  if (pressed) setTimeout(async () => {
    const still = (await popupIn(tabId, [{list: true}])).find(found => found?.text === seen.text);
    if (still) api(config, '/extension/dismiss-popup', {method: 'POST', body: JSON.stringify({...seen, forget: true})}).catch(() => {});
  }, STILL_THERE_MS);
  return pressed;
};
export const closeConsentEverywhere = async (tabId, {cookiesOnly = false} = {}) => {
  const cookie = await closeCookies(tabId, {cookiesOnly});
  return cookie || closePopup(tabId);
};
const closeCookies = async (tabId, {cookiesOnly = false} = {}) => {
  const only = cookiesOnly ? {cookiesOnly: true} : {};
  const pressed = (await inFrames(tabId, [only])).find(Boolean);
  if (pressed) return pressed;
  const buttons = [...new Set((await inFrames(tabId, [{list: true, ...only}])).flatMap(found => (Array.isArray(found) ? found : [])))].slice(0, 20);
  if (!buttons.length) return '';
  const config = await settings().catch(() => null);
  for (const value of ['Reject all cookies that are not necessary', 'Accept cookies']) {
    const choice = config && (await api(config, '/extension/pick-choice', {method: 'POST', body: JSON.stringify({label: 'A cookie banner', value, options: buttons})}).catch(() => null))?.choice;
    if (!choice) continue;
    const pressed = (await inFrames(tabId, [{press: choice, ...only}])).find(Boolean) || '';
    // Still offered after the press: the banner did not close, so the kept answer is dropped (desktop/lib/kept-decisions.js).
    if (pressed) setTimeout(async () => {
      const left = (await inFrames(tabId, [{list: true, ...only}])).flatMap(found => (Array.isArray(found) ? found : []));
      if (left.includes(choice)) api(config, '/extension/pick-choice', {method: 'POST', body: JSON.stringify({label: 'A cookie banner', value, options: buttons, forget: true})}).catch(() => {});
    }, STILL_THERE_MS);
    return pressed;
  }
  return '';
};
