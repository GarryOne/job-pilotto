/* global CSS, document, getComputedStyle, NodeFilter */
// Deterministic UI checks, run on every page the journey visits: the layout bugs a person sees at a glance and a unit test never does
// (2 Oct 2026: one job row was twenty lines tall). Cheap and exact, no AI. Each finding: {view, severity, kind, detail}.
//   severe  -> fails the journey (the page is visibly broken)
//   warning -> reported, shown in the summary
export const VIEWS = ['focus', 'jobs', 'strategy', 'interviews', 'calendar', 'actions', 'sessions', 'settings'];
export const LIMITS = {rowHeight: 220, cellHeight: 200, minFont: 10};

// Runs inside the page. Returns plain findings (no DOM nodes).
export function inspect({view, limits}) {
  const found = [];
  const visible = el => { const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden' && el.offsetParent !== null; };
  const label = el => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`;
  const snippet = el => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const root = document.querySelector(`.view[data-view="${view}"]`) || document.body;
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 2) {
    // Name what sticks out (the outermost few), so the finding says where to look.
    const edge = document.documentElement.clientWidth + 2;
    const wide = [...document.body.querySelectorAll('*')].filter(el => visible(el) && el.getBoundingClientRect().right > edge)
      .filter(el => ![...el.children].some(child => visible(child) && child.getBoundingClientRect().right > edge))
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right).slice(0, 3)
      .map(el => `${label(el)} (right edge ${Math.round(el.getBoundingClientRect().right)}px)`);
    found.push({view, severity: 'severe', kind: 'page-overflow', detail: `the page scrolls sideways (${document.documentElement.scrollWidth}px wide in a ${document.documentElement.clientWidth}px window)${wide.length ? `; sticking out: ${wide.join(', ')}` : ''}`});
  }
  for (const el of root.querySelectorAll('.job-row, tr, li, .card, .place, [class*="cell"]')) {
    if (!visible(el)) continue;
    const height = Math.round(el.getBoundingClientRect().height);
    const isRow = el.matches('.job-row, tr');
    const limit = isRow ? limits.rowHeight : limits.cellHeight;
    if (height > limit && !el.matches('.card') && el.children.length < 40) {
      found.push({view, severity: isRow ? 'severe' : 'warning', kind: isRow ? 'tall-row' : 'tall-cell', detail: `${label(el)} is ${height}px tall (limit ${limit}): "${snippet(el)}"`});
    }
  }
  const clipped = [];
  for (const el of root.querySelectorAll('h1, h2, h3, b, span, a, button, p, td, label')) {
    if (!visible(el) || el.children.length > 2) continue;
    const style = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 3 && style.overflowX !== 'visible' && style.textOverflow !== 'ellipsis' && el.clientWidth > 0) clipped.push(el);
  }
  for (const el of clipped.slice(0, 5)) found.push({view, severity: 'warning', kind: 'clipped-text', detail: `${label(el)} cuts its text off: "${snippet(el)}"`});
  // Text that runs out of its box and stays visible (overflow: visible), the opposite of clipped: the brand in the icon rail spilling over the page title, a button label running out of its
  // button (2 Oct 2026, issue #47). In the page, and in the app chrome around it (the sidebar and the bottom bar), which the page's own root does not contain.
  const spills = (scope, isChrome) => {
    const hits = [scope, ...scope.querySelectorAll('aside, nav, header, footer, button, a, b, span, p, h1, h2, h3, label, td, li, .card, .brand, .nav, .pill, .tag')].filter(el => {
      if (!visible(el) || !(el.textContent || '').trim()) return false;
      return getComputedStyle(el).overflowX === 'visible' && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 3;
    });
    return hits.filter(el => !hits.some(other => other !== el && el.contains(other))).slice(0, 4)   // the innermost: the container only spills because of what is in it
      .map(el => ({view, severity: 'warning', kind: 'spill', chrome: isChrome, detail: `${label(el)} content runs out of its box (${el.scrollWidth}px of ${el.clientWidth}px): "${snippet(el)}"`}));
  };
  found.push(...spills(root, false));
  for (const area of document.querySelectorAll('.sidebar, #activity')) found.push(...spills(area, true));
  for (const el of root.querySelectorAll('*')) {
    if (!visible(el) || !el.childNodes.length || ![...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);   // size 0 hides a label on purpose (the nav buttons of the icon rail): not tiny text
    if (size > 0 && size < limits.minFont) { found.push({view, severity: 'warning', kind: 'tiny-text', detail: `${label(el)} text is under ${limits.minFont}px: "${snippet(el)}"`}); break; }
  }
  // Sideways overflow INSIDE the page: in the app the document never scrolls sideways (the content area scrolls itself), so the check above alone never saw a
  // too-wide element (4 Oct 2026, found by the recall plants). The page's own scroll containers are measured: the view and the area that scrolls it, not a
  // nested table wrapper that may scroll sideways on purpose.
  if (!found.some(item => item.kind === 'page-overflow')) {
    const containers = [...new Set([root, root.parentElement, document.querySelector('main'), document.querySelector('.content')].filter(Boolean))];
    const scroller = containers.find(el => /(auto|scroll)/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 2 && visible(el));
    if (scroller) found.push({view, severity: 'warning', kind: 'page-overflow', detail: `${label(scroller)} scrolls sideways (${scroller.scrollWidth}px of content in ${scroller.clientWidth}px)`});
  }
  for (const img of root.querySelectorAll('img')) {
    if (visible(img) && img.complete && img.naturalWidth === 0) found.push({view, severity: 'severe', kind: 'broken-image', detail: `${label(img)} does not load`});
  }
  // A spinner is round. A flex rule meant for text (a min-width on a notice's first child) once stretched the setup banner's into a 280px line (6 Oct 2026).
  // offsetWidth/Height ignore the rotation animation, which would otherwise make a long thin box look square at some angle.
  for (const spinner of root.querySelectorAll('.spinner')) {
    const [w, h] = [spinner.offsetWidth, spinner.offsetHeight];
    if (visible(spinner) && Math.max(w, h) > 2 * Math.max(1, Math.min(w, h))) {
      found.push({view, severity: 'warning', kind: 'distorted-spinner', detail: `${label(spinner)} is ${w}x${h}px: a spinner should be round`}); break;
    }
  }
  for (const button of root.querySelectorAll('button, a[href]')) {
    if (visible(button) && !(button.textContent || '').trim() && !button.getAttribute('aria-label') && !button.title && !button.querySelector('svg, img')) {
      found.push({view, severity: 'warning', kind: 'unnamed-control', detail: `${label(button)} has no text, label or icon`}); break;
    }
  }
  // Technical text shown to a person: an API's JSON error body, a request id, a stack trace, a raw exception, "[object Object]". It blocks them (they cannot tell what
  // happened or what to do), so it is severe. 3 Oct 2026: "400 {"type":"error",…,"request_id":…}" sat in the CV card and was filed as a CSS spill (#94); no check knew
  // what the text MEANT. Places that show technical text on purpose are left out: code and log blocks, terminals, text fields, the technical-log toggles.
  const TECH = [/\{\s*"type"\s*:\s*"error"/, /"request_id"\s*:/, /\b(?:invalid_request_error|authentication_error|permission_error|rate_limit_error|overloaded_error|api_error)\b/,
    /Traceback \(most recent call last\)/, /\bat [\w$.<>]+ \([^)]*:\d+:\d+\)/, /\[object Object\]/, /\bError code: \d{3}\b/,
    /\b(?:BadRequestError|APIConnectionError|RateLimitError|AuthenticationError|InternalServerError|TypeError|ReferenceError|SyntaxError|KeyError|AttributeError): /];
  const ON_PURPOSE = 'pre, code, textarea, input, .xterm, .terminal, [data-technical], .tech-log, details';
  const scopes = [root, ...document.querySelectorAll('dialog[open], #toasts, #activity')];
  const seen = new Set();
  for (const scope of scopes) {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node && seen.size < 3; node = walker.nextNode()) {
      const host = node.parentElement;
      if (!host || seen.has(host) || host.closest(ON_PURPOSE) || !visible(host)) continue;
      // The host's own words without the on-purpose blocks inside it: a panel whose full log is open (a failed run opens it by itself) holds the log's Traceback, and so did every
      // ancestor of it (#298: three severe findings on a page whose reason was in plain words).
      const copy = host.cloneNode(true);
      for (const block of copy.querySelectorAll(ON_PURPOSE)) block.remove();
      const text = (copy.textContent || '').replace(/\s+/g, ' ').trim();
      if (!TECH.some(pattern => pattern.test(text))) continue;
      seen.add(host);
      found.push({view, severity: 'severe', kind: 'error-shown', detail: `${label(host)} shows technical text to the person: "${text.slice(0, 160)}"`});
    }
  }
  // CONTENT SHOWN IN THE WRONG FORM. The type of bug behind 5 Oct 2026: a Jobs check's digest showed as raw Telegram text in the run's
  // detail pane, above its own card. The screen looked tidy, so no layout check fired. Three checks, from exact to heuristic:
  // (1) card-fallback: the window marks a box that shows a carded run's message as plain text (renderer/run-cards.js markFallback).
  for (const host of document.querySelectorAll('[data-fallback]')) {
    if (!visible(host)) continue;
    found.push({view, severity: 'warning', kind: 'card-fallback', detail: `${label(host)} shows a ${host.dataset.fallback} run's message as plain text instead of its card: "${snippet(host)}"`});
  }
  // (00) card-unstructured: a card that DRAWS but whose parser did not read the message (5 Oct 2026: the Search analysis card was one
  // 800-character paragraph with "Finding:", "Worked", "Focus" and "Full report in Notion (https://…)" run together under the wrong title).
  // A paragraph or list item inside a card that is very long, or still carries the chat message's own markers, was never split into parts.
  for (const host of document.querySelectorAll('.insight-card p, .insight-card li, .run-card p, .run-card li, .mail-card p, .mail-card li')) {
    if (!visible(host)) continue;
    const words = (host.innerText || '').replace(/\s+/g, ' ').trim();
    const why = words.length > 450 ? `one ${words.length}-character paragraph` : /Full report in Notion\s*\(https?:|\bFinding:\s|Tap a job number|Full analysis and transcript\s*\(/.test(words) ? 'the chat message\'s own markers' : '';
    if (!why) continue;
    found.push({view, severity: 'warning', kind: 'card-unstructured', detail: `${label(host)} in a card is ${why}, so its message was not split into parts: "${snippet(host)}"`});
    break;
  }
  // (0) empty-result: a finished run that always leaves a result (Search analysis, Gmail check, insight…) opened to a pane with none (renderer/run-cards.js emptyResult).
  for (const host of document.querySelectorAll('[data-empty-result]')) {
    if (!visible(host)) continue;
    found.push({view, severity: 'warning', kind: 'empty-result', detail: `${label(host)} opened a finished ${host.dataset.emptyResult} run and shows no result: only its header and log`});
  }
  // (2) raw-markup: text formatted for somewhere else, shown unrendered: chat formatting (a numbered list with raw links in brackets,
  // "Tap a job number…", /commands, the engine's message markers), Markdown, HTML tags or entities typed out as text.
  const RAW = [[/Tap a job number\b/i, 'chat'], [/(?:^|\s)\d+\.\s[^\n]{3,200}?\(https?:\/\/[^)\s]+\)/, 'chat'], [/(?:^|\s)\/(?:apply|save|dismiss|more)_\w+/, 'chat'],
    [/<<<message|message>>>/, 'engine marker'], [/\*\*[^*\n]{2,80}\*\*/, 'Markdown'], [/(?:^|\n)#{1,3} \S/, 'Markdown'], [/\[[^\]\n]{1,80}\]\(https?:\/\//, 'Markdown'],
    [/<\/?(?:b|i|a|p|br|div|span|ul|li|strong|em)\b[^>]*>/i, 'HTML'], [/&(?:amp|lt|gt|quot|nbsp|#\d{2,5});/, 'HTML entity'],
    // A line that ends in a bare address in brackets ("Full report in Notion (https://…)"): how a chat message links, never how this app does.
    [/(?:^|\n)[^\n(]{3,80} \(https?:\/\/[^)\s]+\)[ \t]*(?=\n|$)/, 'chat link']];
  // A chat report typed out in one plain box: three or more lines that each start with an emoji ("📊 …", "💡 …", "🔧 …"). Only a box with no elements inside,
  // so a list of separate rows that each start with an icon is not it.
  const emojiReport = host => host.children.length === 0 && ((host.innerText || '').match(/(?:^|\n)\p{Extended_Pictographic}/gu) || []).length >= 3;
  const rawSeen = new Set();
  for (const scope of [root, ...document.querySelectorAll('dialog[open], #toasts, #activity, #activity-panel')]) {
    for (const host of scope.querySelectorAll('div, p, section, li, span, pre')) {
      if (rawSeen.size >= 2 || rawSeen.has(host) || (host.closest(ON_PURPOSE) && !host.closest('[data-fallback]')) || !visible(host)) continue;
      if ([...host.children].some(child => RAW.some(([pattern]) => pattern.test(child.innerText || '')))) continue;   // the innermost box only
      const text = host.innerText || '';
      const hit = RAW.find(([pattern]) => pattern.test(text)) || (emojiReport(host) ? [null, 'chat report'] : null);
      if (!hit) continue;
      rawSeen.add(host);
      found.push({view, severity: 'warning', kind: 'raw-markup', detail: `${label(host)} shows ${hit[1]} formatting as raw text: "${text.replace(/\s+/g, ' ').trim().slice(0, 140)}"`});
    }
  }
  // (3) duplicate-content: two separate boxes in sight that say mostly the same thing (a card and its raw source, a warning printed
  // twice, a summary above its own details). Compared by their words; one box inside the other is not a duplicate.
  const words = el => new Set((el.innerText || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
  // The Recent activity panel is a sheet over the page: with it open, the page's own boxes behind it are not what the person reads, so only the panel's boxes are compared (#284: the Actions result card
  // behind the panel and the panel's message said the same, by design, and were never on screen together).
  const panel = document.getElementById('activity-panel'), panelOpen = !!panel && !panel.hidden && panel.getBoundingClientRect().height > 0;
  const scope = panelOpen ? '#activity-panel div, #activity-panel pre, dialog[open] div' : '.view:not([hidden]) div, .view:not([hidden]) section, .view:not([hidden]) pre, #activity-panel div, #activity-panel pre, dialog[open] div';
  const blocks = [...document.querySelectorAll(scope)]
    .filter(el => visible(el) && !el.closest('pre code, .xterm, textarea, details:not([open]), #log, pre.log, .tech-log, [data-technical]') && (el.innerText || '').length >= 120)   // the run's own log repeats the card's words on purpose (#282, #283, #285)
    .filter(el => ![...el.children].some(child => (child.innerText || '').length >= 0.8 * (el.innerText || '').length))   // the innermost box that holds the text
    .slice(0, 80).map(el => ({el, set: words(el)})).filter(item => item.set.size >= 15);
  const dupes = [];
  for (let a = 0; a < blocks.length && dupes.length < 2; a++) {
    for (let b = a + 1; b < blocks.length && dupes.length < 2; b++) {
      const [x, y] = [blocks[a], blocks[b]];
      if (x.el.contains(y.el) || y.el.contains(x.el)) continue;
      // Rows of one list (the same class three or more times: the job rows of Jobs, the runs of Recent activity) are alike by design: two postings for similar roles are two rows (#288).
      const rowClass = x.el.className && x.el.className === y.el.className && typeof x.el.className === 'string' ? x.el.className.trim().split(/\s+/)[0] : '';
      if (rowClass && document.querySelectorAll(`.${CSS.escape(rowClass)}`).length >= 3) continue;
      let shared = 0;
      for (const word of x.set) if (y.set.has(word)) shared++;
      const overlap = shared / Math.min(x.set.size, y.set.size);
      if (overlap >= 0.7) dupes.push(`${label(x.el)} and ${label(y.el)} share ${Math.round(overlap * 100)}% of their words: "${snippet(x.el)}"`);
    }
  }
  for (const detail of dupes) found.push({view, severity: 'warning', kind: 'duplicate-content', detail});
  // The window's menu: every one of its buttons must be reachable. The owner (4 Oct 2026) shrank the window to its smallest height and could not reach the bottom menu items: the column
  // scrolled, but its scrollbar was hidden and nothing showed it. A control cut off by the window edge (or by an ancestor that clips) with nothing to scroll is "unreachable-control";
  // one whose scroll container shows no scrollbar is "hidden-scroll". A scrollable list with a visible scrollbar is fine.
  const menu = document.querySelector('.sidebar');
  if (menu && visible(menu)) {
    const clips = el => { const style = getComputedStyle(el); return style.overflowY !== 'visible' || style.overflowX !== 'visible'; };
    const cutBy = control => {   // -> the clipping ancestors that hide part of the control, nearest first
      const box = control.getBoundingClientRect(), hiding = [];
      for (let p = control.parentElement; p; p = p.parentElement) {
        if (!(p === document.documentElement || clips(p))) continue;
        const edge = p === document.documentElement ? {top: 0, bottom: document.documentElement.clientHeight} : p.getBoundingClientRect();
        if (box.bottom > edge.bottom + 1 || box.top < edge.top - 1) hiding.push(p);
      }
      return hiding;
    };
    const quiet = el => getComputedStyle(el).scrollbarWidth === 'none' || getComputedStyle(el, '::-webkit-scrollbar').display === 'none';
    const reported = new Set();
    for (const control of menu.querySelectorAll('button, a[href]')) {
      if (!visible(control) || reported.size >= 2) continue;
      const hiding = cutBy(control);
      if (!hiding.length) continue;
      const scroller = hiding.find(el => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1);
      const kind = !scroller ? 'unreachable-control' : quiet(scroller) ? 'hidden-scroll' : '';
      if (!kind || reported.has(kind)) continue;
      reported.add(kind);
      found.push({view, severity: 'warning', kind, detail: kind === 'hidden-scroll'
        ? `"${snippet(control)}" is cut off at this window size and ${label(scroller)} scrolls with no visible scrollbar, so nothing tells the person the menu scrolls (${scroller.scrollHeight}px of menu in ${scroller.clientHeight}px)`
        : `"${snippet(control)}" is cut off at this window size and nothing scrolls, so the person cannot reach it`});
    }
  }
  // WRONG RESULTS the page states about itself (5 Oct 2026): the serious bugs the Finder found only by luck. Two parts of one screen that must agree, checked exactly.
  // A month grid must hold every day of its month once, in order: #120 and #122 lost Sunday 4 October in a time zone.
  // By id, but every visible one: a recall plant repeats the ids inside the page showing.
  const shown = id => [...document.querySelectorAll(`[id="${id}"]`)].filter(visible);
  for (const grid of shown('cal-grid')) {
    const days = [...grid.querySelectorAll('.cal-cell:not(.out) .cal-num')].map(node => Number(node.textContent));
    const title = ((grid.parentElement?.querySelector('[id="cal-title"]') || shown('cal-title')[0])?.textContent || '').trim();
    const first = new Date(`1 ${title}`);
    const want = Number.isNaN(first.getTime()) ? 0 : new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const missing = [], repeated = [];
    const top = want || Math.max(0, ...days);
    for (let day = 1; day <= top; day++) { const n = days.filter(value => value === day).length; if (!n) missing.push(day); else if (n > 1) repeated.push(day); }
    const ordered = days.every((value, i) => !i || value > days[i - 1]);
    if (days.length && (missing.length || repeated.length || !ordered || (want && days.length !== want))) {
      found.push({view, severity: 'warning', kind: 'wrong-result', detail: `the month grid of "${title}" is wrong: ${[missing.length ? `day ${missing.join(', ')} missing` : '', repeated.length ? `day ${repeated.join(', ')} twice` : '', !ordered ? 'days out of order' : '', want && days.length !== want ? `${days.length} days shown, the month has ${want}` : ''].filter(Boolean).join('; ')}`});
    }
  }
  // A run's status pill and its steps must tell the same story: #104 showed a Failed run with every step ticked green.
  // Each status with the step list of its OWN run: the nearest container holding both. Pairing by position mixed the real Activity panel with another
  // copy on the page (the recall plant): a "Completed" plant was judged against the panel's "Failed" (5 Oct 2026, a missed plant).
  const ownPhases = status => { for (let box = status.parentElement; box; box = box.parentElement) { const list = box.querySelector('[id="activity-phases"]'); if (list) return visible(list) ? list : null; } return null; };   // the nearest list decides; hidden = nothing to compare
  for (const status of shown('activity-status')) {
    const phases = ownPhases(status);
    if (!phases) continue;
    const said = (status.textContent || '').trim();
    const steps = [...phases.children].filter(item => visible(item) && !item.classList.contains('update'));
    const all = name => steps.length > 0 && steps.every(item => item.classList.contains(name));
    const any = name => steps.some(item => item.classList.contains(name));
    const wrong = /fail|stopp/i.test(said) && all('done') ? `the run says "${said}" but every step is ticked done`
      : /warning/i.test(said) && all('done') && !any('warn') ? `the run says "${said}" but every step is ticked done and none is marked`
      : /^completed$/i.test(said) && any('fail') ? `the run says "${said}" but a step is marked failed` : '';
    if (wrong) found.push({view, severity: 'warning', kind: 'wrong-result', detail: wrong});
  }
  return found;
}

// Runs inside the page. What a single picture cannot show: what was MOVING when it was taken (a scrolling ticker, a spinner, a fading toast) and which text is cut ON PURPOSE
// (an ellipsis, a line clamp, a fade mask). The AI review gets both as facts, so a frozen ticker (#97) or a deliberate clamp is known, not guessed.
export function motionFacts() {
  const label = el => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`;
  const text = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const shown = el => { const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const moving = [], clipped = [];
  for (const animation of (document.getAnimations ? document.getAnimations() : [])) {
    const el = animation.effect?.target;
    if (!el || animation.playState !== 'running' || !shown(el) || moving.length >= 8) continue;
    const entry = `${label(el)}${text(el) ? `: "${text(el)}"` : ''}`;
    if (!moving.includes(entry)) moving.push(entry);
  }
  for (const el of document.querySelectorAll('body *')) {
    if (clipped.length >= 8) break;
    if (!shown(el) || !(el.innerText || '').trim() || el.children.length > 3) continue;
    const style = getComputedStyle(el);
    const cut = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
    const onPurpose = style.textOverflow === 'ellipsis' || (style.webkitLineClamp && style.webkitLineClamp !== 'none') || (style.maskImage && style.maskImage !== 'none') || (style.webkitMaskImage && style.webkitMaskImage !== 'none');
    if (cut && onPurpose) clipped.push(`${label(el)}: "${text(el)}"`);
  }
  return {moving, clippedOnPurpose: clipped};
}
