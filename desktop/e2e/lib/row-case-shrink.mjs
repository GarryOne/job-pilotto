/* global document */
// A row's pages shrunk for a case folder (npm run row-to-case; owner-approved 11 Oct 2026: real pages stay, fonts/images/scripts/tracking/queries go; sizes measured on three real captures, 84-168 KB):
// the CSS is cut to the rules some captured state uses (a selector that matches an element in ANY state of the page keeps its rule, so a dialog shown by a class in a later state survives), fonts,
// keyframes, imports and every url(...) are dropped, the sheets of one host become ONE stylesheet at <host>/__case/styles.css (linked from each page; the replay serves it like any sheet),
// data: images go from the markup. Text and structure are untouched. Guard: e2e/test/row-case-shrink.test.mjs.
// pages: [{url, file, html}] (every state and frame), harCss: [css text of the run's cross-origin sheets]. -> {pages: [{url, file, html}], sheets: Map(<stylesheet address> -> css)}.

// Runs IN the page: the rules of every sheet (the page's own, plus `extra` texts) kept when their selector matches something here. -> [cssText]
function usedRules(extra) {
  for (const text of extra) { const style = document.createElement('style'); style.textContent = text; document.head.append(style); }
  const dynamic = /::?(?:hover|focus(?:-visible|-within)?|active|visited|link|before|after|placeholder|selection|first-line|first-letter|-[a-z-]+|backdrop|file-selector-button|marker|disabled|checked|invalid|valid|required|optional|not\(.*?\))/gi;
  const matches = selector => { try { return !!document.querySelector(selector.replace(dynamic, '')) || /(^|[\s,>+~])(?:html|body|:root|\*)(?![\w-])/.test(selector); } catch { return true; } };
  const keep = rules => rules.flatMap(rule => {
    const text = rule.cssText;
    if (/^@(font-face|keyframes|-webkit-keyframes|import|charset)\b/i.test(text)) return [];
    if (rule.cssRules && !rule.selectorText) { const inner = keep([...rule.cssRules]); return inner.length ? [`${text.slice(0, text.indexOf('{')).trim()} {\n${inner.join('\n')}\n}`] : []; }
    return rule.selectorText && !matches(rule.selectorText) ? [] : [text];
  });
  const out = [];
  for (const sheet of document.styleSheets) { try { out.push(...keep([...sheet.cssRules])); } catch { /* a sheet the page cannot read */ } }
  return out.map(text => text.replace(/url\([^)]*\)/gi, 'none'));
}

export async function shrinkPages(chromium, pages, harCss = [], {exe} = {}) {
  const browser = await chromium.launch({headless: true, ...(exe ? {executablePath: exe} : {})});
  const hosts = new Map();   // host -> Set of kept rule texts, in first-seen order
  try {
    const tab = await browser.newPage();
    for (const one of pages) {
      await tab.route('**/*', route => route.abort());   // nothing from the network: sheets come from the markup and harCss
      await tab.setContent(one.html, {waitUntil: 'domcontentloaded'});
      const rules = await tab.evaluate(usedRules, harCss);
      const host = new URL(one.url).host, set = hosts.get(host) || new Set();
      for (const rule of rules) set.add(rule);
      hosts.set(host, set);
    }
  } finally { await browser.close(); }
  const sheetOf = url => `https://${new URL(url).host}/__case/styles.css`;
  const sheets = new Map([...hosts].map(([host, set]) => [`https://${host}/__case/styles.css`, [...set].join('\n')]));
  const shrunk = pages.map(one => {
    const html = one.html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, '').replace(/\s(src|srcset)="data:[^"]*"/gi, '')
      .replace(/<\/head>/i, `<link rel="stylesheet" href="${sheetOf(one.url)}"></head>`);
    return {url: one.url, file: one.file, html};
  });
  return {pages: shrunk, sheets};
}
