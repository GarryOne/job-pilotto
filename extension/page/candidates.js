// Numbered candidates of a page (page/candidates.js, rung 3 of the ladder): the sentences, links, buttons and addresses of the posting's own text, found by STRUCTURE only (region, element, an
// email- or phone-shaped string; no word, vendor or language list), so the page-kind AI can answer "how is this applied to?" by NUMBER and never write text or actions (spec docs/superpowers/specs/2026-10-10-ai-ladder.md, rung 3).
// At most 12, 160 characters each. A link carries its host only (never an address with a query string), nothing a person typed or a hidden text is read.
// Owner of asking and acting on the answer: the flow core (desktop/lib/digest.js validates it). Guard: worker/test/page-candidates.test.js.
(() => {
  const MAX = 12, MAX_TEXT = 160;
  const MAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;
  const PHONE = /\+?\d[\d\s().\/-]{6,}\d/;
  const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, td, th, dd, dt, blockquote, div, section, article, main, header, footer, aside, nav, ul, ol, table, tr, form';
  const SKIP = 'script, style, noscript, template, textarea, select, option, input, svg, [aria-hidden="true"]';
  const clean = (text, max = MAX_TEXT) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const digits = (text) => String(text).replace(/\D/g, '').length;
  const shown = (el) => el.getClientRects().length > 0 && !el.closest(SKIP);
  // The visible text of a block: no typed value (textarea, select, input), no script, no hidden part, and a button's label is an action of its own, not a sentence.
  function textOf(el) {
    const walker = el.ownerDocument.createTreeWalker(el, 4);
    let text = '';
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent && !parent.closest(`${SKIP}, button, [role="button"]`) && parent.getClientRects().length) text += `${node.nodeValue} `;
    }
    return text;
  }

  // A banner or modal by structure: inside a dialog, or an ancestor drawn fixed over the page (a consent banner, a chat box): its buttons are not the posting's.
  function overlay(el) {
    if (el.closest('dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return true;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const style = node.ownerDocument.defaultView.getComputedStyle(node);
      if (style && style.position === 'fixed') return true;
    }
    return false;
  }

  // A link or control drawn as a button: a filled background and a button-sized box (style, not words).
  function drawnAsButton(el) {
    const background = el.ownerDocument.defaultView.getComputedStyle(el).backgroundColor || '';
    const filled = background && background !== 'transparent' && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(background);
    const box = el.getBoundingClientRect();
    return filled && box.width >= 80 && box.height >= 28;
  }

  function positionOf(el, root, hasMain) {
    if (el.closest('footer, [role="contentinfo"]')) return 'footer';
    if (el.closest('header, nav, [role="banner"], [role="navigation"]')) return 'header';
    return root.contains(el) && (hasMain || root === el.ownerDocument.body) ? 'main' : 'other';
  }

  function candidatesOf(doc = document) {
    const root = doc.querySelector('main, article, [role="main"]') || doc.body;
    const hasMain = root !== doc.body;
    if (!root) return [];
    const found = {email: [], phone: [], action: [], sentence: [], outside: []};
    const seen = new Set();
    const add = (bucket, item) => { const key = `${item.kind}|${item.text.toLowerCase()}`; if (!item.text || seen.has(key)) return false; seen.add(key); found[bucket].push(item); return true; };

    // Sentences of the leaf text blocks (a block with no block inside), in document order.
    for (const leaf of doc.body.querySelectorAll(BLOCK)) {
      if (leaf.querySelector(BLOCK) || !shown(leaf)) continue;
      const position = positionOf(leaf, root, hasMain);
      for (const part of clean(textOf(leaf), 2000).split(/(?<=[.!?。！？])\s+/)) {
        const text = clean(part);
        if (text.length < 3) continue;
        if (MAIL.test(text)) add(position === 'main' ? 'email' : 'outside', {kind: 'email', text, position});
        else if (digits(text.match(PHONE)?.[0] || '') >= 8) add(position === 'main' ? 'phone' : 'outside', {kind: 'phone', text, position});
        else if (position === 'main') add('sentence', {kind: 'sentence', text, position});
      }
    }
    // A call to action is often shown twice (top and bottom of the posting): an action whose text repeats is ranked up.
    const counts = new Map();
    for (const el of doc.body.querySelectorAll('a[href], button, [role="button"]')) { const key = clean(el.textContent, 80).toLowerCase(); if (key && shown(el)) counts.set(key, (counts.get(key) || 0) + 1); }
    const repeated = new Set([...counts].filter(([, count]) => count >= 2).map(([key]) => key));
    // mailto and tel links, then links and buttons (a link keeps its host, never its address).
    for (const el of doc.body.querySelectorAll('a[href], button, [role="button"], input[type="button"], input[type="submit"]')) {
      if (!shown(el)) continue;
      const position = positionOf(el, root, hasMain), href = el.tagName === 'A' ? el.getAttribute('href') || '' : '';
      const text = clean(el.tagName === 'INPUT' ? el.value : el.textContent, 80);
      if (/^mailto:/i.test(href)) { const address = href.slice(7).split('?')[0]; if (MAIL.test(address)) add(position === 'main' ? 'email' : 'outside', {kind: 'email', text: clean(address), position}); continue; }
      if (/^tel:/i.test(href)) continue;   // the number is the phone's own text; never read from an address
      if (!text) continue;
      let host = '';
      if (el.tagName === 'A') {
        try { const url = new URL(href, doc.location?.href || undefined); if (!/^https?:$/.test(url.protocol)) continue; host = url.hostname; } catch { continue; }
      }
      const item = {kind: el.tagName === 'A' ? 'link' : 'button', text, ...(host ? {host} : {}), position};
      // Which actions come first, by structure: a real button or a link to ANOTHER site (an application system) before a link of the same site; a link inside a menu (a list of 5+ links) last.
      const menu = el.closest('ul, ol, nav, [role="menu"], [role="list"]');
      const rank = (overlay(el) ? 4 : 0) + (menu && menu.querySelectorAll('a[href]').length >= 5 ? 2 : 0) + (item.kind === 'button' || (host && host !== (doc.location?.hostname || '')) || drawnAsButton(el) || repeated.has(item.text.toLowerCase()) ? 0 : 1);
      if (position === 'main') { if (add('action', item)) found.action[found.action.length - 1].rank = rank; } else add('outside', item);
    }
    const actions = found.action.map((item, order) => ({item, order})).sort((a, b) => a.item.rank - b.item.rank || a.order - b.order).map(({item}) => { const {rank: _rank, ...clean} = item; return clean; });   // best first, document order within a rank
    const picked = [...found.email.slice(0, 3), ...found.phone.slice(0, 2), ...actions.slice(0, 6)];
    const reserve = Math.min(2, found.outside.length);   // room kept for them, but the posting's own text comes first
    picked.push(...found.sentence.slice(0, Math.max(0, MAX - picked.length - reserve)));
    picked.push(...found.outside.slice(0, Math.max(0, Math.min(2, MAX - picked.length))));   // at most 2 from a header or footer
    return picked.slice(0, MAX).map((item, index) => ({n: index + 1, ...item}));
  }
  const api = {candidatesOf};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.__jobPilottoCandidates = api;
})();
