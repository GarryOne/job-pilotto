// Turns the Telegram HTML the engine already builds (src/tgcard.py) into a safe e-mail body: only b, i, u, s, code, pre and https links survive, everything else is escaped text.
// This is how every Telegram message gets an e-mail form without a second layout. Guard: test/account-email.test.js.
const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unescape = text => String(text).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');
const TAG = /<(\/?)(b|strong|i|em|u|s|code|pre|a)(\s[^>]*)?>/gi;
const HREF = /href="(https:\/\/[^"\s<>]{1,500})"/i;

export const MAX_HTML = 20000;

// -> {html, text}. Telegram's own entities (&amp; &lt; &gt;) stay as they are; a tag outside the list is shown as text, never run.
export function fromTelegram(source) {
  const input = String(source || '').slice(0, MAX_HTML);
  let html = '', text = '', last = 0, href = null;
  const stack = [];
  const plain = chunk => { html += esc(unescape(chunk)).replace(/\n/g, '<br>'); text += unescape(chunk); };
  for (const m of input.matchAll(TAG)) {
    plain(input.slice(last, m.index)); last = m.index + m[0].length;
    const [, closing, name, attrs] = m, tag = name.toLowerCase();
    if (tag === 'a') {
      if (closing) { if (href) { html += '</a>'; text += ` (${href})`; href = null; } continue; }
      const url = HREF.exec(attrs || '')?.[1];
      if (url) { href = unescape(url); html += `<a href="${esc(href)}">`; }
      continue;
    }
    if (closing) { if (stack.at(-1) === tag) { stack.pop(); html += `</${tag}>`; } } else { stack.push(tag); html += `<${tag}>`; }
  }
  plain(input.slice(last));
  if (href) html += '</a>';
  while (stack.length) html += `</${stack.pop()}>`;
  return {html, text: text.trim()};
}
