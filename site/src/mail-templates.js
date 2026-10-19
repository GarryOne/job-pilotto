// The mails we send, by name. src/mail.js puts each through the frame (src/mail-frame.js: logo, title, button, footer with the unsubscribe and settings links) and adds the headers. A template says its list
// ('service' or 'marketing'), whether it is `essential` (a sign-in code: not stopped by an unsubscribe), and builds subject, title, content (text and html) and an optional one `button` from plain data. Guard: test/mail.test.js.
import {codeBox, esc, jobRows, jobText, link} from './mail-frame.js';

// A message the app or an Always on run would send on Telegram, in the same layout: data {subject, html, text, buttons: [{text, url}], confirmUrl} (html/text from src/mail-html.js).
// The first button is the frame's one orange button; the others are links under the text.
const moreHtml = (buttons = []) => buttons.slice(1).map(b => `<p>${link(b.url, b.text)}</p>`).join('');
const moreText = (buttons = []) => buttons.slice(1).map(b => `${b.text}: ${b.url}`).join('\n');
const confirmHtml = url => (url ? `<p>${link(url, 'Confirm your email')} so these mails keep coming.</p>` : '');
const confirmText = url => (url ? `\nConfirm your email so these mails keep coming: ${url}` : '');
const first = (buttons = []) => (buttons[0] ? {label: buttons[0].text, url: buttons[0].url} : null);

const SITE = 'https://www.jobpilotto.top';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const muted = text => `<p class="jp-muted" style="margin:0 0 14px;color:#667085;font-size:13.5px">${esc(text)}</p>`;

export const TEMPLATES = {
  'message': {list: 'service',
    subject: ({subject}) => String(subject || 'Jobadabra').slice(0, 150),
    title: ({subject}) => String(subject || 'Jobadabra').slice(0, 150),
    button: ({buttons}) => first(buttons),
    text: ({text, buttons, confirmUrl}) => [text, moreText(buttons)].filter(Boolean).join('\n\n') + confirmText(confirmUrl),
    html: ({html, buttons, confirmUrl}) => `${html}${moreHtml(buttons)}${confirmHtml(confirmUrl)}`},
  // Account mail: the code that proves an address (Pro device codes, sign-in). Data: {code}.
  'account-code': {list: 'service', essential: true,
    subject: () => 'Your Jobadabra code',
    title: () => 'Your sign-in code',
    text: ({code}) => `Your Jobadabra code is ${code}.\n\nType it in the app within 10 minutes. If you did not ask for it, ignore this email; nothing changes.`,
    html: ({code}) => `${codeBox(code)}${muted("Type it in the app within 10 minutes. If you didn't ask for it, ignore this email; nothing changes.")}`},
  // The new-matches mail, one per run. Data: {matches: [{title, company, place, mode, fit, url}], total, openUrl?}. A service mail: never a promotion.
  'digest': {list: 'service',
    subject: ({total, matches = []}) => `${total ?? matches.length} new job match${(total ?? matches.length) === 1 ? '' : 'es'}`,
    title: ({total, matches = []}) => ((total ?? matches.length) === 1 ? '1 new match' : `${total ?? matches.length} new matches`),
    button: ({openUrl}) => ({label: 'Open in Jobadabra', url: openUrl || SITE}),
    text: ({matches = []}) => jobText(matches),
    html: ({matches = [], total}) => `${(total ?? matches.length) > matches.length ? muted(`The top ${matches.length} of ${total}.`) : ''}${jobRows(matches)}`},
  // Trial reminders (src/mail-lifecycle.js): service mails, facts only, no promotion. Data: {left} / {days}. Off unless env.TRIAL_REMINDERS = "on".
  'trial-left': {list: 'service',
    subject: ({left}) => `${plural(left, 'free application')} left`,
    title: ({left}) => `${plural(left, 'free application')} left`,
    text: ({left}) => `You have ${plural(left, 'application')} left in your free Jobadabra trial (20 applications or 60 days, whichever lasts longer).\nSearches, tracking and your data keep working as they are.`,
    html: ({left}) => `<p>You have <b>${esc(left)}</b> ${left === 1 ? 'application' : 'applications'} left in your free Jobadabra trial (20 applications or 60 days, whichever lasts longer).</p><p>Searches, tracking and your data keep working as they are.</p>`},
  'trial-ending': {list: 'service',
    subject: ({days}) => `Your free trial ends in ${plural(days, 'day')}`,
    title: ({days}) => `Your free trial ends in ${plural(days, 'day')}`,
    button: ({pricingUrl}) => ({label: 'See the details', url: pricingUrl}),
    text: ({days}) => `Your free Jobadabra trial ends in ${plural(days, 'day')}. After that new searches and drafts pause; your data stays yours.`,
    html: ({days}) => `<p>Your free Jobadabra trial ends in <b>${esc(days)}</b> ${days === 1 ? 'day' : 'days'}. After that new searches and drafts pause; your data stays yours.</p>`},
  // Always on paused (hosted spec §4b). Data: {reason: 'trial-over' | 'inactive', pricingUrl, pro}. Purely functional; the Pro button shows only when `pro` (the owner's marketing flag) is on.
  'always-on-paused': {list: 'service',
    subject: ({reason}) => (reason === 'inactive' ? 'Always on paused: open the app to resume' : 'Always on paused: your free trial has ended'),
    title: ({reason}) => (reason === 'inactive' ? 'Always on is paused' : 'Always on is paused: your free trial has ended'),
    button: ({reason, pricingUrl, pro}) => (reason !== 'inactive' && pro ? {label: 'Get Pro to keep it running', url: pricingUrl} : null),
    text: ({reason}) => (reason === 'inactive' ? "You haven't opened Jobadabra for 14 days, so the daily searches stopped. Open the app to resume." : 'Your free trial has ended, so the daily searches stopped.'),
    html: ({reason}) => (reason === 'inactive' ? "<p>You haven't opened Jobadabra for 14 days, so the daily searches stopped. Open the app to resume.</p>" : '<p>Your free trial has ended, so the daily searches stopped.</p>')},
  // The marketing list: sent by hand (src/mail-lifecycle.js launch), only to opted-in addresses and only with env.MARKETING_MAIL = "on". Data: {price, launch, pricingUrl}.
  'pro-launch': {list: 'marketing',
    subject: () => 'Jobadabra Pro is out',
    title: () => 'Jobadabra Pro is out',
    button: ({pricingUrl}) => ({label: 'See Pro', url: pricingUrl}),
    text: ({price, launch}) => `One payment, no subscription: ${launch ? `$${launch} at launch (then $${price})` : `$${price}`}, VAT included.`,
    html: ({price, launch}) => `<p>One payment, no subscription: ${launch ? `$${esc(launch)} at launch (then $${esc(price)})` : `$${esc(price)}`}, VAT included.</p>`},
};
