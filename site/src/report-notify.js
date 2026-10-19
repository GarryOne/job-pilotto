// The owner's Telegram message for each "Report this form" the Worker stores (docs/superpowers/specs/2026-10-15-report-this-form.md §6): counts only (the cause word, the number of page
// responses, a short install digest, the time), never a host, page or value: the Worker has none. Same bot and chat as the feedback message (BRAIN_BOT_TOKEN, BRAIN_CHAT_ID, Worker secrets).
// After 10 messages in a UTC day one "more reports today" line replaces the rest, so a burst is not a storm. A failure to tell never fails the upload. Guarded by test/report-form.test.js.
import {esc} from './stats.js';

export const TELL_PER_DAY = 10;

// The cause in plain words, for the message and for /admin/reports. The app sends a word (X-Report-Meta cause; the Worker keeps a-z, 0-9, _ and -): the ladder's signals get a sentence,
// any other word is spelled out (wrong_page -> "Wrong page"), none is "No cause given". A new word needs no change here.
const CAUSES = {person: 'Reported by the person', stalled: 'Stalled on the form', failed: 'The fill failed', contradicted: 'Answer contradicted the page', unsure: 'Not sure how to fill', blind: 'Could not read the page', refused: 'A control refused the value'};
export const causeWords = cause => CAUSES[cause] || (cause ? cause.replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase()) : 'No cause given');

export function reportMessage({cause, requests, who, now, base}) {
  const time = now.toISOString().slice(11, 16);
  return `📮 <b>A form was reported</b> · ${esc(causeWords(cause))} · ${Number(requests) || 0} page responses · install ${esc(String(who).slice(0, 8))} · ${time} UTC\n<a href="${esc(base)}/admin/reports">/admin/reports</a>`;
}
export const moreMessage = base => `📮 <b>More forms were reported today</b>: no more messages until tomorrow, the list is on <a href="${esc(base)}/admin/reports">/admin/reports</a>`;

// `count` = this report's place in the day (1 = the first). Returns true when a message went out; never throws.
export async function tellOwner(env, report, count, fetcher = fetch) {
  if (!env.BRAIN_BOT_TOKEN || !env.BRAIN_CHAT_ID || count > TELL_PER_DAY + 1) return false;
  const base = env.SITE_URL || 'https://www.jobadabra.top';
  const text = count > TELL_PER_DAY ? moreMessage(base) : reportMessage({...report, base});
  try {
    const answer = await fetcher(`https://api.telegram.org/bot${env.BRAIN_BOT_TOKEN}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({chat_id: env.BRAIN_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true}), signal: AbortSignal.timeout(3000)});
    return answer.ok;
  } catch (error) { console.log('report notify failed', error.message); return false; }
}
