// Telegram from the desktop app: the user's own bot (made with @BotFather), no webhook, no Cloudflare.
// The app long-polls Telegram for button taps and commands while it runs, and handles them with the
// Worker's own code (worker/src/index.js handleUpdate); its "dispatch" runs the pipeline locally.
import {handleAdd, handleCommand, handleUpdate} from '../shared/worker/index.js';
import * as github from './github.js';
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
    if (workflow === 'mail.yml') {  // tracked like a scheduled check, so the activity bar shows it
      pipeline.checkMail(storage, onLine, 'you').catch(error => onLine(`Gmail check failed: ${error.message}`));
      return;
    }
    let args;
    if (workflow === 'scout.yml') args = ['src', 'scout', '--send', '--batch', String(inputs.batch || 15)];
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
    // With "keep working while my Mac is off" on, runs happen in the user's GitHub repo.
    dispatch: settings.cloud?.repo ? github.cloudDispatch(storage, onLine) : localDispatch(storage, onLine),
    status: () => {
      const s = storage.settings();
      if (s.cloud?.repo) return `☁️ Job Pilotto works from your GitHub repo ${s.cloud.repo} on your schedule, even with the Mac off.`;
      return s.lastSearchAt ? `🖥️ Last search from the Job Pilotto app: ${new Date(s.lastSearchAt).toLocaleString()}` +
        `${s.lastSearchOk === false ? ' (with problems)' : ''}. Next one on your schedule while the app is open.` : '🖥️ No search yet.';
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

// The Telegram commands, run from the app's buttons. The reply goes to Telegram when it's connected
// (same message as typing the command), and back to the window as plain text either way.
export const plainText = html => String(html || '').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

export async function runCommand(storage, name, arg = '', onLine = () => {}, fetcher) {
  const env = telegramEnv(storage, onLine);
  const answer = name === 'add' ? await handleAdd(env, `/add ${arg}`) : await handleCommand(env, {name, arg});
  const {text, keyboard} = typeof answer === 'string' ? {text: answer} : answer;
  if (env.TELEGRAM_BOT_TOKEN && env.OWNER_CHAT_ID) {
    await api(env.TELEGRAM_BOT_TOKEN, 'sendMessage', {chat_id: env.OWNER_CHAT_ID, text, parse_mode: 'HTML',
      disable_web_page_preview: true, ...(keyboard ? {reply_markup: keyboard} : {})}, fetcher).catch(error => onLine(`Telegram: ${error.message}`));
  }
  return {text: plainText(text), telegram: !!(env.TELEGRAM_BOT_TOKEN && env.OWNER_CHAT_ID)};
}
