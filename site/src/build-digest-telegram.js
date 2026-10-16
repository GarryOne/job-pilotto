// The Build Log Telegram post: the day's FINAL digest as HTML messages (Telegram's markdown dislikes plain text), split at group boundaries under its 4096-character limit (spec docs/superpowers/specs/2026-10-16-daily-digest.md).
// A separate bot and chat from the job digest bot and the CI alerts (secrets BUILDLOG_TELEGRAM_TOKEN / BUILDLOG_TELEGRAM_CHAT). Pure + an injected fetch, so tests never reach Telegram. Guard: test/build-digest-telegram.test.js.
import {countOf, dayWords, prList} from './build-digest.js';

const LIMIT = 3800;
const html = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function messages({day, groups, open, numbers}) {
  const {count, min, max} = countOf(numbers);
  const intro = count ? `Here's what we achieved on ${html(dayWords(day))}, grouped by goal. About ${count} PR${count === 1 ? '' : 's'} merged, from #${min} to #${max}.` : `Nothing was merged on ${html(dayWords(day))}.`;
  const blocks = groups.map(group => `${html(group.emoji)} <b>${html(group.title)}</b>\n${group.bullets.map(bullet => `• <b>${html(bullet.lead)}.</b> ${html(bullet.text)} (${html(prList(bullet.prs))})`).join('\n')}`);
  blocks.push(`<b>Still open:</b> ${html(open || 'Nothing open.')}`);
  const out = [];
  let current = intro;
  for (const block of blocks) {
    if (current.length + block.length + 2 > LIMIT) { out.push(current); current = block; } else current += `\n\n${block}`;
  }
  out.push(current);
  return out;
}

// Sends them in order. No token or chat: {skipped} (the digest is still stored; the post is the one thing missing). A Telegram error throws, naming only the status (never the token).
export async function post(result, {token, chat, fetch: doFetch = fetch}) {
  if (!token || !chat) return {skipped: 'BUILDLOG_TELEGRAM_TOKEN / BUILDLOG_TELEGRAM_CHAT are not set'};
  const list = messages(result);
  for (const text of list) {
    const response = await doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true})});
    if (!response.ok) throw new Error(`Telegram answered ${response.status}`);
  }
  return {sent: list.length};
}
