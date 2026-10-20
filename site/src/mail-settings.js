// The e-mail settings page a mail's footer links to (owner, 17 Oct 2026): service mail on/off, the digest daily or weekly, product news on/off. No sign-in: the signed link is the one the stop link uses
// (tokenFor(address digest, 'unsub-service')). GET shows the form (a mail scanner opening the link changes nothing); POST saves. Product news shows off and locked while env.MARKETING_MAIL is not "on". Guard: test/mail-settings.test.js.
import {equal, tokenFor} from './guard.js';
import {esc} from './mail-frame.js';
import {CADENCES} from './mail-held.js';
import {page, switchOff} from './mail-unsub.js';

const bad = () => page('This link does not work', '<p>It may be cut off. Open the link from the mail again.</p>', 400);
const row = (name, checked, label, note, disabled = false) => `<p><label><input type="checkbox" name="${name}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}> <b>${label}</b></label><br><small style="color:#667085">${note}</small></p>`;

async function stateOf(env, addr) {
  const off = (await env.STATS.prepare("SELECT list FROM mail_off WHERE addr = ? AND list IN ('all', 'service', 'marketing')").bind(addr).all()).results || [];
  const account = await env.STATS.prepare('SELECT marketing_opt_in, service_mail_off_at, digest_cadence FROM pro_accounts WHERE email_hash = ?').bind(addr).first().catch(() => null);
  const lists = new Set(off.map(r => r.list));
  return {blocked: lists.has('all'), service: !lists.has('service') && !account?.service_mail_off_at, cadence: account?.digest_cadence || 'daily', marketing: !!account?.marketing_opt_in && !lists.has('marketing'), account};
}

export async function settings(request, env, now = new Date()) {
  if (!env.STATS) return page('Not available', '', 503);
  const url = new URL(request.url), addr = url.searchParams.get('a') || '', token = url.searchParams.get('t') || '';
  if (!/^[0-9a-f]{16}$/.test(addr) || !equal(token, await tokenFor(addr, env, 'unsub-service'))) return bad();
  if (request.method === 'POST') {
    const form = await request.formData().catch(() => new FormData());
    const before = await stateOf(env, addr);
    if (!before.blocked) {
      if (form.get('service')) {
        await env.STATS.prepare("DELETE FROM mail_off WHERE addr = ? AND list = 'service'").bind(addr).run();
        await env.STATS.prepare('UPDATE pro_accounts SET service_mail_off_at = NULL WHERE email_hash = ?').bind(addr).run();
      } else await switchOff(env, addr, 'service', 'settings', now);
    }
    if (CADENCES.includes(form.get('cadence'))) await env.STATS.prepare('UPDATE pro_accounts SET digest_cadence = ? WHERE email_hash = ?').bind(form.get('cadence'), addr).run();
    if (env.MARKETING_MAIL === 'on' && !before.blocked) {   // product news can be changed only while the owner has it on
      if (form.get('marketing')) {
        await env.STATS.prepare("DELETE FROM mail_off WHERE addr = ? AND list = 'marketing'").bind(addr).run();
        await env.STATS.prepare('UPDATE pro_accounts SET marketing_opt_in = 1, marketing_opt_in_at = ? WHERE email_hash = ?').bind(now.toISOString(), addr).run();
      } else await switchOff(env, addr, 'marketing', 'settings', now);
    }
    return page('Saved', `<p>Your email settings are saved.</p><p><a href="${esc(url.pathname + url.search)}">Back to the settings</a></p>`);
  }
  if (request.method !== 'GET') return page('Not allowed', '', 405);
  const st = await stateOf(env, addr), marketingOn = env.MARKETING_MAIL === 'on';
  const body = `${st.blocked ? '<p><b>Mail to this address is stopped</b> after a bounce or a complaint. Write to hello@jobadabra.top to turn it back on.</p>' : ''}`
    + `<form method="post">${row('service', st.service, 'Jobadabra emails', 'New matches, your digest and account notices.', st.blocked)}`
    + `<p><label><b>Digest</b><br><select name="cadence"${st.blocked ? ' disabled' : ''}>${CADENCES.map(c => `<option value="${c}"${st.cadence === c ? ' selected' : ''}>${c === 'daily' ? 'One email a day' : 'One email a week (Mondays)'}</option>`).join('')}</select></label><br><small style="color:#667085">Everything except new matches, which arrive at once.</small></p>`
    + `${row('marketing', marketingOn && st.marketing, 'Product news', marketingOn ? 'News and offers, only when there is something to say.' : 'Off. We are not sending any product news right now.', !marketingOn || st.blocked)}`
    + `<button style="font:inherit;padding:.5rem 1rem;background:#d0612b;color:#fff;border:0;border-radius:8px"${st.blocked ? ' disabled' : ''}>Save</button></form>`;
  return page('Email settings', body);
}
