// One formatter for the messages the alert bots send (owner, 16 Oct 2026): Telegram HTML with a bold title, a blank line, "•" bullets, named links, never a bare URL.
// Pure and dependency-free, so a Cloudflare Worker can import it as it is (the Sentry alerts bot does). Guard: e2e/test/telegram-html.test.mjs.
//   alertHtml({icon, title, verdict, bullets: [{label, parts: [text | {text, url}]}], links: [{text, url}]}) -> {text, parse_mode: 'HTML', link_preview_options}
// parts: a string is plain text (escaped here); {text, url} is a named link (http/https only, else plain text). Longer than Telegram's 4096: the longest bullet is shortened.
export const LIMIT = 4096;
export const esc = text => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = url => esc(url).replace(/"/g, '&quot;');
export const link = (text, url) => (/^https?:\/\/[^\s"<>]+$/.test(String(url || '')) ? `<a href="${attr(url)}">${esc(text)}</a>` : esc(text));
const part = one => (typeof one === 'string' ? esc(one) : link(one.text, one.url));
const shorten = (text, max) => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).replace(/\s+\S*$/, '')}…`);

export function alertHtml({icon = '', title = '', verdict = '', bullets = [], links = []}) {
  const head = `${icon ? `${icon} ` : ''}<b>${esc(title)}</b>${verdict ? ` ${esc(verdict)}` : ''}`;
  const build = lengths => [head, bullets.length ? `\n${bullets.map((one, i) => `• ${one.label ? `${esc(one.label)}: ` : ''}${one.parts.map(item => (typeof item === 'string' ? esc(shorten(item, lengths[i])) : part(item))).join('')}`).join('\n')}` : '', links.length ? `\n${links.map(one => link(one.text, one.url)).join(' · ')}` : ''].filter(Boolean).join('\n');
  const lengths = bullets.map(() => 1500);
  let text = build(lengths);
  for (let guard = 0; text.length > LIMIT && guard < 40; guard++) { const at = lengths.indexOf(Math.max(...lengths)); lengths[at] = Math.max(40, Math.floor(lengths[at] * 0.7)); text = build(lengths); }
  return {text: text.slice(0, LIMIT), parse_mode: 'HTML', link_preview_options: {is_disabled: true}, disable_web_page_preview: true};
}
