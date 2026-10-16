// The mails we send, by name (src/mail.js adds the footer, the unsubscribe links and the headers). Each template says its list ('service' or 'marketing'),
// whether it is `essential` (a sign-in code: not stopped by an unsubscribe), and builds subject, text and html from plain data. Guard: test/mail.test.js.
const esc = text => String(text ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const link = (url, label) => `<a href="${esc(url)}">${esc(label)}</a>`;

// A message the app or an Always on run would send on Telegram, in the same layout: data {subject, html, text, buttons: [{text, url}], confirmUrl} (html/text from src/mail-html.js).
const buttonsHtml = (buttons = []) => buttons.map(b => `<p>${link(b.url, b.text)}</p>`).join('');
const buttonsText = (buttons = []) => buttons.map(b => `${b.text}: ${b.url}`).join('\n');
const confirmHtml = url => (url ? `<p>${link(url, 'Confirm your email')} so these mails keep coming.</p>` : '');
const confirmText = url => (url ? `\nConfirm your email so these mails keep coming: ${url}` : '');

export const TEMPLATES = {
  'message': {list: 'service',
    subject: ({subject}) => String(subject || 'Job Pilotto').slice(0, 150),
    text: ({text, buttons, confirmUrl}) => [text, buttonsText(buttons)].filter(Boolean).join('\n\n') + confirmText(confirmUrl),
    html: ({html, buttons, confirmUrl}) => `${html}${buttonsHtml(buttons)}${confirmHtml(confirmUrl)}`},
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
  // Trial reminders (src/mail-lifecycle.js): service mails, facts only, no promotion. Data: {left} / {days}.
  'trial-left': {list: 'service',
    subject: ({left}) => `${left} free application${left === 1 ? '' : 's'} left`,
    text: ({left}) => `You have ${left} application${left === 1 ? '' : 's'} left in your free Job Pilotto trial (20 applications or 60 days, whichever lasts longer).\nSearches, tracking and your data keep working as they are.`,
    html: ({left}) => `<p>You have <b>${esc(left)}</b> application${left === 1 ? '' : 's'} left in your free Job Pilotto trial (20 applications or 60 days, whichever lasts longer).</p><p>Searches, tracking and your data keep working as they are.</p>`},
  'trial-ending': {list: 'service',
    subject: ({days}) => `Your free trial ends in ${days} day${days === 1 ? '' : 's'}`,
    text: ({days, pricingUrl}) => `Your free Job Pilotto trial ends in ${days} day${days === 1 ? '' : 's'}. After that new searches and drafts pause; your data stays yours.\nDetails: ${pricingUrl}`,
    html: ({days, pricingUrl}) => `<p>Your free Job Pilotto trial ends in <b>${esc(days)}</b> day${days === 1 ? '' : 's'}. After that new searches and drafts pause; your data stays yours.</p><p>${link(pricingUrl, 'Details')}</p>`},
  // The one service mail that may carry the Pro line (hosted spec §4b). Data: {reason: 'trial-over' | 'inactive', pricingUrl}.
  'always-on-paused': {list: 'service',
    subject: ({reason}) => (reason === 'inactive' ? 'Always on paused: open the app to resume' : 'Always on paused: get Pro to keep it running'),
    text: ({reason, pricingUrl}) => (reason === 'inactive' ? 'Always on paused because the app has not been opened for 14 days. Open Job Pilotto, or use the link below to stop these mails.'
      : `Your free trial is over, so Always on paused. Get Pro to keep it running: ${pricingUrl}`),
    html: ({reason, pricingUrl}) => (reason === 'inactive' ? '<p>Always on paused because the app has not been opened for 14 days. Open Job Pilotto to resume.</p>'
      : `<p>Your free trial is over, so Always on paused. ${link(pricingUrl, 'Get Pro to keep it running')}.</p>`)},
  // The marketing list: sent by hand (src/mail-lifecycle.js launch), only to opted-in addresses. Data: {price, launch, pricingUrl}.
  'pro-launch': {list: 'marketing',
    subject: () => 'Job Pilotto Pro is out',
    text: ({price, launch, pricingUrl}) => `Pro is out: one payment, no subscription, ${launch ? `$${launch} at launch (then $${price})` : `$${price}`}, VAT included.\n${pricingUrl}`,
    html: ({price, launch, pricingUrl}) => `<p><b>Pro is out.</b> One payment, no subscription: ${launch ? `$${esc(launch)} at launch (then $${esc(price)})` : `$${esc(price)}`}, VAT included.</p><p>${link(pricingUrl, 'See Pro')}</p>`},
};
