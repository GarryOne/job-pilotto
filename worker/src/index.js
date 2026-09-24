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
  '/apply_&lt;code&gt; — tap the code under a job to mark it applied',
  '/status — last workflow runs',
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

async function dispatch(env, inputs) {
  const response = await github(env, `actions/workflows/${env.WORKFLOW_FILE}/dispatches`, {
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

async function applied(env) {
  const response = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_APPLICATIONS_DB}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      page_size: 30,
      filter: { property: 'Stage', select: { does_not_equal: 'Saved' } },
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
    case 'apply':
      if (!/^[0-9a-f]{8}$/.test(command.arg)) return 'Tap the /apply_… code shown under a job in the digest.';
      await dispatch(env, { mode: 'apply', job: command.arg });
      return '⏳ Marking it applied in Notion…';
    case 'status': {
      const response = await github(env, `actions/workflows/${env.WORKFLOW_FILE}/runs?per_page=5`);
      if (!response.ok) throw new Error(`GitHub runs failed: ${response.status}`);
      return formatRuns((await response.json()).workflow_runs);
    }
    default:
      return `I don't know that command.\n\n${HELP}`;
  }
}

// A tap on a digest's "✅ n" button arrives as callback_query with data "apply:<code>".
async function handleButton(env, query) {
  if (String(query.message?.chat?.id) !== String(env.OWNER_CHAT_ID)) return;
  const code = /^apply:([0-9a-f]{8})$/.exec(query.data || '')?.[1];
  try {
    if (!code) throw new Error('Unknown button');
    await dispatch(env, { mode: 'apply', job: code });
    await telegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Marking it applied in Notion…' });
  } catch (error) {
    await telegram(env, 'answerCallbackQuery', {
      callback_query_id: query.id, text: `⚠️ ${error.message}`.slice(0, 200), show_alert: true,
    });
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
