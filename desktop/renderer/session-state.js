// A session's state as the window shows it, from what the app reports (lib/terminals.js publicView) and Claude's
// last message. No window needed: tested in desktop/test/session-state.test.js.
import {readSessionMessage} from './session-message.js';

export const SESSION_STATE = {running: ['Applying', 'info'], input: ['Question for you', 'warn'], done: ['Ready for review', 'warn'],
  ended: ['Ended', 'neutral'], failed: ['Stopped', 'bad'], submit: ['Ready to submit', 'good']};
// Claude is running in it (demo sessions say nothing: they run while not ended).
export const isLive = item => item.live ?? !item.endedAt;
// Waiting for you after filling the form (its message says so) counts as "ready for review", like a finished one.
export const REVIEW_WORDS = /form (?:is )?(?:now )?(?:filled|ready|complete)|filled (?:the|every|all|\d+)|ready for (?:your )?review|before you submit|submit it yourself|ready for you to review|nothing was submitted/i;
// Claude asks you something when one of its own sentences (outside its report's lists) ends with "?"; a listed form
// question ("Any relatives working at Acme?") is not Claude asking.
export const asksYou = item => (item.question ? readSessionMessage(item.question).intro.some(line => /\?\**\s*$/.test(line)) : /\?\s*$/.test(item.brief || ''));
// A message that ends on a question still waits for your answer first.
export const sessionReview = item => item.status === 'done'
  || (item.status === 'input' && REVIEW_WORDS.test(item.question || '') && !asksYou(item));
// formReady: the form page says every required field is filled (the extension's ring is green): ready to submit.
export const sessionState = (item, formReady = false) => (sessionReview(item) ? (formReady ? SESSION_STATE.submit : SESSION_STATE.done)
  : SESSION_STATE[item.status] || SESSION_STATE.ended);
// How long it worked (until it ended or waited for you), "42s", "3m 05s", "1h 02m".
export function sessionDuration(item, now = Date.now()) {
  const end = item.endedAt || item.needsYouSince;
  const seconds = Math.max(0, Math.round(((end ? new Date(end) : new Date(now)) - new Date(item.startedAt)) / 1000));
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}m`;
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
}
// The part of a text shown on its row: all of it when short, else whole sentences up to the limit (at least one).
export function firstLine(text, limit = 110) {
  if (text.length <= limit) return text;
  let shown = '';
  for (const sentence of text.split(/(?<=\.)\s+/)) {
    if (shown && shown.length + sentence.length + 1 > limit) break;
    shown = shown ? `${shown} ${sentence}` : sentence;
  }
  return shown;
}
