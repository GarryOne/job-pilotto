// Telegram message text for the worker: HTML escaping and the run / applications / saved-jobs listings.
// Pure functions of Notion/GitHub rows, no I/O. Re-exported by index.js. Guarded by worker/test/index.test.js and status.test.js.

export const STAGE_EMOJI = {
  Saved: '⭐', Applied: '📨', 'Confirmation received': '📬', Screening: '📞',
  'Interview scheduled': '🗓', Interviewing: '🎤', Offer: '🎉', Rejected: '❌',
  Withdrawn: '↩️', 'No response': '💤', 'Recruiter lead': '🤝',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function formatRuns(runs) {
  if (!runs.length) return 'No workflow runs yet.';
  const icon = (run) => run.status !== 'completed' ? '⏳' : run.conclusion === 'success' ? '✅' : '❌';
  const lines = runs.map((run) => {
    const when = run.created_at.replace('T', ' ').slice(0, 16);
    return `${icon(run)} <a href="${escapeHtml(run.html_url)}">${escapeHtml(run.display_title)}</a> · ${when} UTC`;
  });
  return [`🛠 <b>Recent runs</b>\n${lines.length} latest`, lines.join('\n\n')].join('\n\n');
}

// /status: the latest ⏱️ Search runs rows, wherever they ran (the Mac, GitHub, a button here), with the one running.
export function formatNotionRuns(pages) {
  if (!pages.length) return 'No runs yet.';
  const text = (prop) => (prop?.rich_text || prop?.title || []).map((t) => t.plain_text).join('');
  const ICON = { Running: '⏳', Failed: '❌', Warnings: '⚠️' };
  const lines = pages.map((page) => {
    const p = page.properties;
    const status = p.Status?.select?.name || '';
    const when = (p.Started?.date?.start || '').replace('T', ' ').slice(0, 16);
    const where = p['Run URL']?.url ? ' · GitHub' : /^Mac/.test(p.Trigger?.select?.name || '') ? ' · Mac' : '';
    const summary = text(p.Summary).replace(/;?\s*\(?AI cost \$[\d.]+\)?\.?$/, '');
    return `${ICON[status] || '✅'} <a href="${escapeHtml(page.url)}">${escapeHtml(p.Mode?.select?.name || 'run')}</a> · ${when} UTC${where}`
      + (summary ? `\n${escapeHtml(summary.slice(0, 160))}` : '');
  });
  return [`🛠 <b>Recent runs</b>\n${lines.length} latest`, lines.join('\n\n')].join('\n\n');
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
    const interview = p['Next interview']?.date?.start ? `\nInterview: ${p['Next interview'].date.start.slice(0, 16).replace('T', ' · ')}` : '';
    return `${index + 1}. ${url ? `<a href="${escapeHtml(url)}">${title}</a>` : title}\n`
      + `${escapeHtml(text(p.Company))} · ${STAGE_EMOJI[stage] || ''} ${escapeHtml(stage)}\n`
      + `Applied: ${applied}${interview}`;
  });
  return [`📋 <b>Applications</b>\n${pages.length} tracked · <a href="${databaseUrl}">Open in Notion</a>`, lines.join('\n\n')].join('\n\n');
}

export function formatSaved(pages, databaseUrl) {
  const text = (prop) => (prop?.rich_text || prop?.title || []).map((t) => t.plain_text).join('');
  if (!pages.length) return 'No saved jobs. Tap a job number in a digest, then ⭐ Save.';
  const lines = pages.map((page, i) => {
    const p = page.properties;
    const url = p['Job URL']?.url;
    const title = `<b>${escapeHtml(text(p.Job) || 'Untitled')}</b>`;
    return `${i + 1}. ${url ? `<a href="${escapeHtml(url)}">${title}</a>` : title}\n${escapeHtml(text(p.Company))}`;
  });
  return [`⭐ <b>Saved jobs</b>\n${pages.length} saved · <a href="${databaseUrl}">Open in Notion</a>`, lines.join('\n\n')].join('\n\n');
}
