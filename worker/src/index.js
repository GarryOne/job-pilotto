// Telegram webhook for @swiss_sre_watch_bot.
//
// Quick commands (/help, /status, /applied) are answered here. Commands that
// need the job database (/run, /today, /apply_<code>) start the GitHub
// workflow, which replies in Telegram when it finishes.

const HELP = [
  '🇨🇭 <b>SRE Watch commands</b>',
  '',
  '/run — crawl now and send the digest (~3 min)',
  '/today — send the current ranked list (~1 min)',
  '/applied — jobs you applied to, with stage',
  '/saved — jobs you saved with ⭐',
  'Under a digest, tap a job number → ✅ Applied · ⭐ Save · ❌ Dismiss',
  '/status — last workflow runs',
  '/scout — look for new employer job feeds now (~1 min)',
].join('\n');

const STAGE_EMOJI = {
  Saved: '⭐', Applied: '📨', 'Confirmation received': '📬', Screening: '📞',
  'Interview scheduled': '🗓', Interviewing: '🎤', Offer: '🎉', Rejected: '❌',
  Withdrawn: '↩️', 'No response': '💤',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// "/apply_ab12cd34@swiss_sre_watch_bot" -> { name: "apply", arg: "ab12cd34" }
export function parseCommand(text) {
  const match = /^\/([a-z]+)(?:_([0-9a-z]+))?(?:@\w+)?(?:\s|$)/i.exec((text || '').trim());
  return match ? { name: match[1].toLowerCase(), arg: (match[2] || '').toLowerCase() } : null;
}

async function telegram(env, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Telegram ${method} failed: ${response.status}`);
  return response.json();
}

function reply(env, text) {
  return telegram(env, 'sendMessage', {
    chat_id: env.OWNER_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true,
  });
}

function github(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'sre-watch-bot',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

async function dispatch(env, inputs, workflow = env.WORKFLOW_FILE) {
  const response = await github(env, `actions/workflows/${workflow}/dispatches`, {
    method: 'POST', body: JSON.stringify({ ref: 'main', inputs }),
  });
  if (response.status !== 204) throw new Error(`GitHub dispatch failed: ${response.status} ${await response.text()}`);
}

export function formatRuns(runs) {
  if (!runs.length) return 'No workflow runs yet.';
  const icon = (run) => run.status !== 'completed' ? '⏳' : run.conclusion === 'success' ? '✅' : '❌';
  const lines = runs.map((run) => {
    const when = run.created_at.replace('T', ' ').slice(0, 16);
    return `${icon(run)} <a href="${escapeHtml(run.html_url)}">${escapeHtml(run.display_title)}</a> · ${when} UTC`;
  });
  return ['🛠 <b>Recent runs</b>', ...lines].join('\n');
}

export function formatApplied(pages, databaseUrl) {
  const text = (prop) => (prop?.rich_text || prop?.title || []).map((t) => t.plain_text).join('');
  if (!pages.length) return `No applications yet. Tap /apply_&lt;code&gt; under a job, or add one in <a href="${databaseUrl}">Notion</a>.`;
  const lines = pages.map((page, index) => {
    const p = page.properties;
    const stage = p.Stage?.select?.name || 'No stage';
    const applied = p['Applied on']?.date?.start || 'date not set';
    const url = p['Job URL']?.url;
    const title = `<b>${escapeHtml(text(p.Job) || 'Untitled')}</b>`;
    const interview = p['Next interview']?.date?.start ? ` · 🗓 ${p['Next interview'].date.start.slice(0, 16)}` : '';
    return `${index + 1}. ${url ? `<a href="${escapeHtml(url)}">${title}</a>` : title} — ${escapeHtml(text(p.Company))}\n`
      + `${STAGE_EMOJI[stage] || '•'} ${escapeHtml(stage)} · 📅 applied ${applied}${interview}`;
  });
  return [`📋 <b>Applications</b> (${pages.length}) · <a href="${databaseUrl}">open in Notion</a>`, '', lines.join('\n\n')].join('\n');
}

async function queryApplications(env, filter, sorts) {
  const response = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_APPLICATIONS_DB}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page_size: 30, filter, sorts }),
  });
  if (!response.ok) throw new Error(`Notion query failed: ${response.status}`);
  return (await response.json()).results;
}

export function formatSaved(pages, databaseUrl) {
  const text = (prop) => (prop?.rich_text || prop?.title || []).map((t) => t.plain_text).join('');
  if (!pages.length) return 'No saved jobs. Tap a job number in a digest, then ⭐ Save.';
  const lines = pages.map((page, i) => {
    const p = page.properties;
    const url = p['Job URL']?.url;
    const title = `<b>${escapeHtml(text(p.Job) || 'Untitled')}</b>`;
    return `${i + 1}. ${url ? `<a href="${escapeHtml(url)}">${title}</a>` : title} — ${escapeHtml(text(p.Company))}`;
  });
  return [`⭐ <b>Saved jobs</b> (${pages.length}) · <a href="${databaseUrl}">open in Notion</a>`, '', lines.join('\n')].join('\n');
}

async function saved(env) {
  const results = await queryApplications(env, { property: 'Stage', select: { equals: 'Saved' } },
    [{ timestamp: 'created_time', direction: 'descending' }]);
  return formatSaved(results, `https://www.notion.so/${env.NOTION_APPLICATIONS_DB}`);
}

async function applied(env) {
  const response = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_APPLICATIONS_DB}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      page_size: 30,
      filter: { and: [{ property: 'Stage', select: { does_not_equal: 'Saved' } },
                      { property: 'Stage', select: { does_not_equal: 'Dismissed' } }] },
      sorts: [{ property: 'Applied on', direction: 'descending' }],
    }),
  });
  if (!response.ok) throw new Error(`Notion query failed: ${response.status}`);
  const { results } = await response.json();
  return formatApplied(results, `https://www.notion.so/${env.NOTION_APPLICATIONS_DB}`);
}

export async function handleCommand(env, command) {
  switch (command?.name) {
    case 'start':
    case 'help':
      return HELP;
    case 'run':
      await dispatch(env, { mode: 'run' });
      return '🔄 Crawling now. The digest arrives in about 3 minutes.';
    case 'today':
      await dispatch(env, { mode: 'today' });
      return '📋 Sending the current list in about a minute.';
    case 'applied':
      return applied(env);
    case 'saved':
      return saved(env);
    case 'apply':
      if (!/^[0-9a-f]{8}$/.test(command.arg)) return 'Tap the /apply_… code shown under a job in the digest.';
      await dispatch(env, { mode: 'apply', job: command.arg });
      return '⏳ Marking it applied in Notion…';
    case 'scout':
      await dispatch(env, { batch: '15' }, 'scout.yml');
      return '🔎 Scouting 15 companies for new job feeds; the summary arrives in about a minute.';
    case 'status': {
      const response = await github(env, `actions/workflows/${env.WORKFLOW_FILE}/runs?per_page=5`);
      if (!response.ok) throw new Error(`GitHub runs failed: ${response.status}`);
      return formatRuns((await response.json()).workflow_runs);
    }
    default:
      return `I don't know that command.\n\n${HELP}`;
  }
}

// Digest buttons arrive as callback_query: "apply:<code>" (✅ n) or "more:<seed>:<page>" (➕ Next).
// Digest buttons (callback_query data):
//   pick:<code>:<n>        number n tapped -> show an action row for that job on the same message
//   act:<a|s|d>:<code>:<n> Applied / Save / Dismiss -> dispatch an apply run, mark the number button
//   close                  hide the action row
//   more:<seed>:<page>     next page;  apply:<code>  legacy ✅ button from older digests
const ACTIONS = { a: ['applied', '✅', 'Marking it applied in Notion…'],
                  s: ['saved', '⭐', 'Saved — it stays in digests with a star.'],
                  d: ['dismissed', '❌', "Dismissed — it won't show again."] };

const isActionRow = (row) => row.some((b) => /^(act:|close)/.test(b.callback_data || ''));

export function withActionRow(markup, code, n) {
  const rows = (markup?.inline_keyboard || []).filter((row) => !isActionRow(row));
  const actionRow = [
    { text: `${n}: ✅ Applied`, callback_data: `act:a:${code}:${n}` },
    { text: '⭐ Save', callback_data: `act:s:${code}:${n}` },
    { text: '❌ Dismiss', callback_data: `act:d:${code}:${n}` },
    { text: '✖', callback_data: 'close' },
  ];
  return { inline_keyboard: [actionRow, ...rows] };
}

export function afterAction(markup, n, emoji) {
  const rows = (markup?.inline_keyboard || []).filter((row) => !isActionRow(row));
  return { inline_keyboard: rows.map((row) => row.map((b) => (
    new RegExp(`^pick:[0-9a-f]{8}:${n}$`).test(b.callback_data || '') ? { ...b, text: `${emoji} ${n}` } : b))) };
}

async function editButtons(env, query, markup) {
  await telegram(env, 'editMessageReplyMarkup', {
    chat_id: query.message.chat.id, message_id: query.message.message_id, reply_markup: markup,
  });
}

async function handleButton(env, query) {
  if (String(query.message?.chat?.id) !== String(env.OWNER_CHAT_ID)) return;
  const data = query.data || '';
  const pick = /^pick:([0-9a-f]{8}):(\d{1,3})$/.exec(data);
  const act = /^act:([asd]):([0-9a-f]{8}):(\d{1,3})$/.exec(data);
  const apply = /^apply:([0-9a-f]{8})$/.exec(data);
  const more = /^more:(\d{1,10}):(\d{1,3})$/.exec(data);
  const answer = (text, alert = false) => telegram(env, 'answerCallbackQuery',
    { callback_query_id: query.id, text: text.slice(0, 200), show_alert: alert });
  try {
    if (pick) {
      await editButtons(env, query, withActionRow(query.message.reply_markup, pick[1], pick[2]));
      await answer(`Job ${pick[2]}: applied, save or dismiss?`);
    } else if (act) {
      const [action, emoji, text] = ACTIONS[act[1]];
      await dispatch(env, { mode: 'apply', job: act[2], action });
      await editButtons(env, query, afterAction(query.message.reply_markup, act[3], emoji));
      await answer(text);
    } else if (data === 'close') {
      await editButtons(env, query, afterAction(query.message.reply_markup, '-', ''));
      await answer('OK');
    } else if (apply) {
      await dispatch(env, { mode: 'apply', job: apply[1], action: 'applied' });
      await answer('Marking it applied in Notion…');
    } else if (more) {
      await dispatch(env, { mode: 'more', seed: more[1], page: more[2] });
      await answer('Loading the next jobs (about a minute)…');
    } else {
      throw new Error('Unknown button');
    }
  } catch (error) {
    await answer(`⚠️ ${error.message}`, true);
  }
}

async function handleUpdate(env, update) {
  if (update.callback_query) return handleButton(env, update.callback_query);
  const message = update.message;
  // Only the owner's private chat may control the bot; ignore everyone else silently.
  if (!message || String(message.chat?.id) !== String(env.OWNER_CHAT_ID)) return;
  try {
    await reply(env, await handleCommand(env, parseCommand(message.text)));
  } catch (error) {
    await reply(env, `⚠️ ${escapeHtml(error.message)}`);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/telegram') return new Response('Not found', { status: 404 });
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
      return new Response('Forbidden', { status: 403 });
    }
    const update = await request.json();
    // Answer Telegram immediately so it doesn't retry; finish the work in the background.
    ctx.waitUntil(handleUpdate(env, update));
    return new Response('ok');
  },
};
