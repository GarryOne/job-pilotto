// The one frame every e-mail goes through (owner, 17 Oct 2026): a branded card with the logo, a title, the content, at most one orange button and a footer saying why the person gets it,
// with "Stop these emails", "Email settings" and jobadabra.top. Email-safe: a table layout, inline styles, a hosted https logo, light colours inline with a dark-mode override in <style>.
// src/mail.js applies it in send(), so no template can skip it; each template supplies only its content. A plain-text twin comes from frameText(). Guard: test/mail-frame.test.js.
export const SITE = 'https://www.jobadabra.top';
const LOGO = `${SITE}/images/logo-mark.png`;
const ACCENT = '#d0612b';
export const esc = text => String(text ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
export const link = (url, label) => `<a href="${esc(url)}" style="color:${ACCENT}">${esc(label)}</a>`;

const FONT = '-apple-system,\'Segoe UI\',Helvetica,Arial,sans-serif';
const STYLE = `<style>
@media (prefers-color-scheme: dark) {
  .jp-bg { background:#0f1218 !important; } .jp-card { background:#161b23 !important; border-color:#252b36 !important; }
  .jp-ink { color:#e8ebf0 !important; } .jp-muted, .jp-muted a { color:#9aa3b2 !important; } .jp-line { border-color:#252b36 !important; }
  .jp-box { background:#0f1218 !important; } .jp-fit { background:#12301f !important; color:#7fd6a2 !important; }
}
@media only screen and (max-width: 520px) { .jp-pad { padding:18px !important; } }
</style>`;

export const button = ({label, url}) => `<p style="margin:18px 0 0"><a href="${esc(url)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:600;border-radius:8px;padding:11px 18px">${esc(label)}</a></p>`;

// The job rows of a digest: title, "company · place · mode" and a fit chip. rows: [{title, company, place, mode, fit, url}].
export function jobRows(rows = []) {
  return rows.map(job => {
    const meta = [job.company, job.place, job.mode].filter(Boolean).join(' · ');
    const title = job.url ? `<a href="${esc(job.url)}" style="color:inherit;text-decoration:none">${esc(job.title)}</a>` : esc(job.title);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="jp-line" style="border-top:1px solid #e6e8ec"><tr>`
      + `<td style="padding:12px 0"><b class="jp-ink" style="display:block">${title}</b>${meta ? `<span class="jp-muted" style="color:#667085;font-size:13px">${esc(meta)}</span>` : ''}</td>`
      + `${job.fit != null ? `<td align="right" valign="middle" style="padding:12px 0 12px 12px"><span class="jp-fit" style="font:600 12px ui-monospace,Menlo,monospace;background:#eaf6ee;color:#1f7a45;border-radius:999px;padding:3px 9px">${esc(job.fit)}</span></td>` : ''}</tr></table>`;
  }).join('');
}
export const jobText = (rows = []) => rows.map(job => `- ${job.title}${[job.company, job.place, job.mode].filter(Boolean).length ? ` (${[job.company, job.place, job.mode].filter(Boolean).join(' · ')})` : ''}${job.fit != null ? ` fit ${job.fit}` : ''}${job.url ? `\n  ${job.url}` : ''}`).join('\n');

export const codeBox = code => `<p class="jp-box jp-ink" style="font:700 30px ui-monospace,Menlo,monospace;letter-spacing:.3em;background:#f4f5f7;border-radius:10px;padding:14px;text-align:center;margin:8px 0 14px">${esc(code)}</p>`;

// html: {title, body (html), button: {label, url} | null, why, links: {stop, settings} | null}. links null = nothing to stop (a security mail): only the site link shows.
export function frameHtml({title, body, button: action, why, links}) {
  const foot = [links && link(links.stop, 'Stop these emails'), links && link(links.settings, 'Email settings'), link(SITE, 'jobadabra.top')].filter(Boolean).join(' · ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(title)}</title>${STYLE}</head>`
    + `<body class="jp-bg" style="margin:0;background:#f4f5f7"><table role="presentation" data-jp-frame="1" width="100%" cellpadding="0" cellspacing="0" class="jp-bg" style="background:#f4f5f7"><tr><td align="center" style="padding:22px 14px">`
    + `<table role="presentation" width="560" cellpadding="0" cellspacing="0" class="jp-card" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e6e8ec;border-radius:12px;font:15px/1.55 ${FONT};color:#161a22">`
    + `<tr><td class="jp-line" style="padding:16px 22px;border-bottom:1px solid #e6e8ec"><img src="${LOGO}" width="32" height="28" alt="" style="vertical-align:middle;border:0"> <b class="jp-ink" style="vertical-align:middle;margin-left:8px;font-size:15px">Jobadabra</b></td></tr>`
    + `<tr><td class="jp-pad jp-ink" style="padding:22px"><h1 class="jp-ink" style="margin:0 0 10px;font-size:20px;line-height:1.3">${esc(title)}</h1>${body}${action ? button(action) : ''}</td></tr></table>`
    + `<p class="jp-muted" style="max-width:560px;margin:14px auto 0;color:#667085;font:12px/1.6 ${FONT};text-align:center">${esc(why)}<br>${foot}</p>`
    + `</td></tr></table></body></html>`;
}

export function frameText({title, body, button: action, why, links}) {
  return [title, '', body, action ? `\n${action.label}: ${action.url}` : '', '', '--', why,
    links ? `Stop these emails: ${links.stop}\nEmail settings: ${links.settings}` : '', SITE].filter(part => part !== null && part !== undefined && part !== false).join('\n').replace(/\n{3,}/g, '\n\n');
}
