// POST /api/brain/telegram: the "Job Pilotto Brain" Telegram bot's webhook. The product brain
// (.github/workflows/product-brain.yml, tools/product_brain.py) sends one recommendation a day with buttons; a tap
// here starts the next step of that workflow on GITHUB_REPO. Product infrastructure, separate from users' job bots.
// Secrets: BRAIN_BOT_TOKEN, BRAIN_WEBHOOK_SECRET (Telegram's secret_token header), BRAIN_CHAT_ID (the owner only),
// BRAIN_GITHUB_TOKEN + var BRAIN_REPO: the private repo the brain's workflow lives in (else GITHUB_TOKEN/GITHUB_REPO).

export const BUTTONS = {
  x: ['explore', '✅ Exploring…', 'Exploring it: the plan arrives here in a few minutes.'],
  n: ['skip', '⏭ Not now', 'Noted: not now.'],
  a: ['another', '🔁 Another idea coming', 'Another recommendation arrives in a few minutes.'],
  ok: ['approve', '✅ Plan approved', 'Approved. Build it in a session when you are ready.'],
};

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
  const [step, label, text] = BUTTONS[tap[1]];
  try {
    const where = env.BRAIN_REPO && env.BRAIN_GITHUB_TOKEN ? {...env, GITHUB_REPO: env.BRAIN_REPO, GITHUB_TOKEN: env.BRAIN_GITHUB_TOKEN} : env;
    await dispatch(where, {step, id: tap[2]}, 'product-brain.yml');
    // The pressed button stays as the record, so it can't be pressed twice.
    await call('editMessageReplyMarkup', {chat_id: query.message.chat.id, message_id: query.message.message_id,
      reply_markup: {inline_keyboard: [[{text: label, callback_data: 'done'}]]}});
    await call('answerCallbackQuery', {callback_query_id: query.id, text});
  } catch (error) {
    await call('answerCallbackQuery', {callback_query_id: query.id, text: `⚠️ ${error.message}`.slice(0, 200), show_alert: true});
  }
  return new Response('ok');
}
