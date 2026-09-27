// Telegram from the desktop app: the user's own bot (made with @BotFather), no webhook, no Cloudflare.
// The app long-polls Telegram for button taps and commands while it runs, and handles them with the
// Worker's own code (worker/src/index.js handleUpdate); its "dispatch" runs the pipeline locally.
import {handleUpdate} from '../../worker/src/index.js';
import * as pipeline from './pipeline.js';

export async function api(token, method, body = {}, fetcher = globalThis.fetch) {
  const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!data.ok) throw Object.assign(new Error(data.description || `Telegram ${response.status}`), {code: data.error_code});
  return data.result;
}

// Wait (up to `seconds`) for the user to press Start in their bot; returns the chat to send to.
export async function pair(token, seconds = 120, fetcher) {
  const bot = await api(token, 'getMe', {}, fetcher);
  let offset;
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    let updates;
    try {
      updates = await api(token, 'getUpdates', {timeout: 20, ...(offset ? {offset} : {})}, fetcher);
    } catch (error) {
      if (error.code === 409) throw new Error('This bot is already connected to a server (a webhook). Create a new bot for the app with @BotFather.');
      throw error;
    }
    for (const update of updates) {
      offset = update.update_id + 1;
      const message = update.message;
      if (message?.chat?.type === 'private' && /^\/start\b/.test(message.text || '')) {
        await api(token, 'getUpdates', {offset, timeout: 0}, fetcher); // don't handle this /start again later
        await api(token, 'sendMessage', {chat_id: message.chat.id, parse_mode: 'HTML',
          text: '✈️ <b>Job Pilotto is connected.</b> New matches arrive here after each search. Send /help for commands.'}, fetcher);
        return {chatId: String(message.chat.id), username: bot.username};
      }
    }
  }
  throw new Error(`No Start received. Open t.me/${bot.username}, press Start, then try again.`);
}

// Inputs from a button or command -> the pipeline, in the background (Telegram gets its reply now).
export function localDispatch(storage, onLine = () => {}) {
  return async (inputs, workflow) => {
    let args;
    if (workflow === 'mail.yml') args = ['src.ai.mail', '--send', '--days', String(inputs.days || 2)];
    else if (workflow === 'scout.yml') args = ['src', 'scout', '--send', '--batch', String(inputs.batch || 15)];
    else args = pipeline.dailyArgs(storage, inputs);
    const crawl = ['scheduled', 'run'].includes(inputs.mode);
    const task = () => pipeline.run(storage, args, onLine);
    (crawl ? pipeline.serial(task) : task()).catch(error => onLine(`Telegram action failed: ${error.message}`));
  };
}

export function telegramEnv(storage, onLine) {
  const settings = storage.settings();
  const ids = settings.notionIds || {};
  return {
    TELEGRAM_BOT_TOKEN: storage.secret('TELEGRAM_BOT_TOKEN'),
    OWNER_CHAT_ID: settings.telegramChatId,
    NOTION_TOKEN: storage.secret('NOTION_TOKEN'),
    NOTION_APPLICATIONS_DB: ids.NOTION_APPLICATIONS_DB || '',
    NOTION_EVENTS_DB: ids.NOTION_EVENTS_DB || '',
    dispatch: localDispatch(storage, onLine),
    status: () => {
      const s = storage.settings();
      return s.lastSearchAt ? `🖥️ Last search from the Job Pilotto app: ${new Date(s.lastSearchAt).toLocaleString()}` +
        `${s.lastSearchOk === false ? ' (with problems)' : ''}. Next one within 4 hours while the app is open.` : '🖥️ No search yet.';
    },
  };
}

// Long polling: runs while the app is open. stop() ends it (e.g. when the token changes).
export function startPolling(storage, onLine = () => {}, fetcher) {
  let running = true;
  (async () => {
    let offset = storage.settings().telegramOffset;
    while (running) {
      const token = storage.secret('TELEGRAM_BOT_TOKEN');
      if (!token || !storage.settings().telegramChatId) return;
      try {
        const updates = await api(token, 'getUpdates', {timeout: 50, ...(offset ? {offset} : {})}, fetcher);
        for (const update of updates) {
          offset = update.update_id + 1;
          storage.saveSettings({telegramOffset: offset});
          await handleUpdate(telegramEnv(storage, onLine), update);
        }
      } catch (error) {
        onLine(`Telegram: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 15000)); // offline or Telegram hiccup: retry later
      }
    }
  })();
  return {stop: () => { running = false; }};
}
