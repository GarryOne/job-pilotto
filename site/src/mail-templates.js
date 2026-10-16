// The mails we send, by name (src/mail.js adds the footer, the unsubscribe links and the headers). Each template says its list ('service' or 'marketing'),
// whether it is `essential` (a sign-in code: not stopped by an unsubscribe), and builds subject, text and html from plain data. Guard: test/mail.test.js.
const esc = text => String(text ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const link = (url, label) => `<a href="${esc(url)}">${esc(label)}</a>`;

export const TEMPLATES = {
  // Account mail: the code that proves an address (Pro device codes, sign-in). Data: {code}.
  'account-code': {list: 'service', essential: true,
    subject: () => 'Your Job Pilotto code',
    text: ({code}) => `Your Job Pilotto code is ${code}.\nIt works for 10 minutes. If you did not ask for it, ignore this mail.`,
    html: ({code}) => `<p>Your Job Pilotto code is <b style="font-size:20px;letter-spacing:2px">${esc(code)}</b>.</p><p>It works for 10 minutes. If you did not ask for it, ignore this mail.</p>`},
  // The new-matches digest, one per run. Data: {matches: [{title, company, fit, url}], total}. A service mail: never a promotion.
  'digest': {list: 'service',
    subject: ({total, matches = []}) => `${total ?? matches.length} new job match${(total ?? matches.length) === 1 ? '' : 'es'}`,
    text: ({matches = [], total}) => [`${total ?? matches.length} new matches:`, '', ...matches.map(m => `- ${m.title}${m.company ? ` at ${m.company}` : ''}${m.fit != null ? ` (fit ${m.fit})` : ''}${m.url ? `\n  ${m.url}` : ''}`)].join('\n'),
    html: ({matches = [], total}) => `<p><b>${esc(total ?? matches.length)} new matches</b></p><ul>${matches.map(m => `<li>${m.url ? link(m.url, m.title) : esc(m.title)}${m.company ? ` at ${esc(m.company)}` : ''}${m.fit != null ? ` (fit ${esc(m.fit)})` : ''}</li>`).join('')}</ul>`},
};
