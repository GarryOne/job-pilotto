// POST /api/brain/telegram: the "Job Pilotto Brain" Telegram bot's webhook. The product brain
// (.github/workflows/product-brain.yml, tools/product_brain.py) sends one recommendation a day with buttons; a tap
// here starts the next step of that workflow on GITHUB_REPO. Product infrastructure, separate from users' job bots.
// Secrets: BRAIN_BOT_TOKEN, BRAIN_WEBHOOK_SECRET (Telegram's secret_token header), BRAIN_CHAT_ID (the owner only),
// BRAIN_GITHUB_TOKEN + var BRAIN_REPO: the private repo the brain's workflow lives in (else GITHUB_TOKEN/GITHUB_REPO).
// Each tap is logged in D1 brain_messages (src/brainlog.js) for /admin/brain.
import {record} from './brainlog.js';

// code -> [workflow step, the button's label after the tap, the answer, the decision's status it leads to]
export const BUTTONS = {
  x: ['explore', '✅ Exploring…', 'Exploring it: the plan arrives here in a few minutes.', 'Exploring'],
  n: ['skip', '⏭ Not now', 'Noted: not now.', 'Not now'],
  a: ['another', '🔁 Another idea coming', 'Another recommendation arrives in a few minutes.', 'Not now'],
  ok: ['approve', '✅ Plan approved', 'Approved. Build it in a session when you are ready.', 'Approved'],
};

// A tap, in the log; a failed write never costs the tap itself (said in the Worker's log instead).
async function logTap(env, id, label, status, telegramId, text) {
  if (!env.STATS) return;
  try {
    await record(env.STATS, {decision: id, kind: 'tap', title: `Tapped ${label}`, text, status, telegram_id: telegramId, source: 'tap'});
  } catch (error) {
    console.log(JSON.stringify({area: 'brain', event: 'tap-log-failed', decision: id, error: String(error.message || error).slice(0, 200)}));
  }
}

export async function brain(request, env, dispatch, fetcher = fetch) {
  if (request.method !== 'POST' || !env.BRAIN_BOT_TOKEN || !env.BRAIN_WEBHOOK_SECRET
      || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.BRAIN_WEBHOOK_SECRET) return new Response('Not found', {status: 404});
  const update = await request.json().catch(() => ({}));
  const query = update.callback_query;
  if (!query || String(query.message?.chat?.id) !== String(env.BRAIN_CHAT_ID)) return new Response('ok');
  const call = (method, body) => fetcher(`https://api.telegram.org/bot${env.BRAIN_BOT_TOKEN}/${method}`,
    {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const tap = /^pb:(x|n|a|ok):([0-9a-f]{32})$/.exec(query.data || '');
  if (!tap) {
    await call('answerCallbackQuery', {callback_query_id: query.id, text: 'Already recorded.'});
    return new Response('ok');
  }
  const [step, label, text, status] = BUTTONS[tap[1]];
  try {
    const where = env.BRAIN_REPO && env.BRAIN_GITHUB_TOKEN ? {...env, GITHUB_REPO: env.BRAIN_REPO, GITHUB_TOKEN: env.BRAIN_GITHUB_TOKEN} : env;
    await dispatch(where, {step, id: tap[2]}, 'product-brain.yml');
    // The pressed button stays as the record, so it can't be pressed twice.
    await call('editMessageReplyMarkup', {chat_id: query.message.chat.id, message_id: query.message.message_id,
      reply_markup: {inline_keyboard: [[{text: label, callback_data: 'done'}]]}});
    await call('answerCallbackQuery', {callback_query_id: query.id, text});
    await logTap(env, tap[2], label, status, query.message.message_id, text);
  } catch (error) {
    await logTap(env, tap[2], label, '', query.message.message_id, `The tap failed: ${error.message}`);
    await call('answerCallbackQuery', {callback_query_id: query.id, text: `⚠️ ${error.message}`.slice(0, 200), show_alert: true});
  }
  return new Response('ok');
}
