// The website: static pages (public/) plus one endpoint, POST /api/waitlist, which keeps Pro early-access
// sign-ups in Cloudflare KV (binding WAITLIST). List them: npx wrangler@4 kv key list --binding WAITLIST --remote
// Optional: with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID set as secrets, each new sign-up is also sent to Telegram.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PER_HOUR = 10;  // sign-ups accepted from one address per hour

const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

export async function waitlist(request, env) {
  if (request.method !== 'POST') return json(405, {ok: false, error: 'Use POST'});
  let form;
  try { form = await request.json(); } catch { return json(400, {ok: false, error: 'Send JSON'}); }
  if (form.website) return json(200, {ok: true});  // honeypot field that people never see: a bot
  const email = String(form.email || '').trim().toLowerCase();
  const role = String(form.role || '').trim().slice(0, 200);
  if (email.length > 254 || !EMAIL.test(email)) return json(400, {ok: false, error: 'Enter an email address like you@example.com.'});

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const recent = Number(await env.WAITLIST.get(`rate:${ip}`)) || 0;
  if (recent >= PER_HOUR) return json(429, {ok: false, error: 'Too many sign-ups from here. Try again in an hour.'});
  await env.WAITLIST.put(`rate:${ip}`, String(recent + 1), {expirationTtl: 3600});

  const key = `signup:${email}`;
  if (await env.WAITLIST.get(key)) return json(200, {ok: true, already: true});
  const entry = {email, role, at: new Date().toISOString(), country: request.cf?.country || ''};
  await env.WAITLIST.put(key, JSON.stringify(entry), {metadata: {at: entry.at, role}});
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({chat_id: env.TELEGRAM_CHAT_ID, text: `✈️ Pro early access: ${email}${role ? ` · ${role}` : ''}`})}).catch(() => {});
  }
  return json(200, {ok: true});
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/api/waitlist') return waitlist(request, env);
    return env.ASSETS.fetch(request);
  },
};
