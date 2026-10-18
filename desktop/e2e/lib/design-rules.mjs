/* global document, getComputedStyle */
// The design rules a screen can be checked against, from the owner's UI feedback (18 Oct 2026; docs/rules/desktop-ui.md "Read views, lists, buttons and choices").
// designRules() runs inside the page (self-contained: page.evaluate sends only its source) on every view a journey visits (lib/layout.mjs snap) and on the
// design-system page's examples (test/design-rules.test.mjs). Each finding names its card: {view, severity, kind, card, detail}. A finding on a screen
// that broke the rule before it was written is listed in KNOWN_LEFT (shrink-only, test/design-rules.test.mjs) with the session fixing it; anything else is severe.
export const RULE_LIMITS = {buttonHeight: 40, listItems: 12, chips: 12, selectOptions: 7};

// scope (optional): a selector to check instead of the view (the design-system page checks one section at a time).
export function designRules({view, limits, scope = ''}) {
  const found = [];
  const root = document.querySelector(scope || `.view[data-view="${view}"]`) || document.body;
  const visible = el => { const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden' && el.offsetParent !== null; };
  const words = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const CARD = '.g-state, .panel, .summary-card, .insight-card, .setting, .answer-item, .card';
  const cardOf = el => el.closest(CARD);
  const cardName = card => (card && words(card.querySelector('h3, h4, h2') || card).slice(0, 50)) || 'page';
  const add = (kind, el, detail) => found.push({view, severity: 'severe', kind, card: cardName(cardOf(el)), detail});
  const READ_ONLY_SKIP = 'input, textarea, select, pre, code, details, .card-editor, .read-note, [data-technical], .tech-log';

  // 1. Read views show values, never raw notes: "[language]" tags, "(note: …)", "(confirmed …)" or "Confirmed 26 Sep 2026" inside a value (a note is a muted
  //    line under its value or a fold). The deepest element whose own words hold it is named.
  const RAW = [/\[[a-z][a-z ]{2,20}\]/, /\(note:/i, /\(confirmed\b/i, /\bconfirmed (?:by [A-Z]\w+ )?\d{1,2} [A-Z][a-z]{2,8} \d{4}/i];
  for (const el of root.querySelectorAll('dd, p, span, div, li, td')) {
    if (!visible(el) || el.closest(READ_ONLY_SKIP) || [...el.children].some(child => RAW.some(re => re.test(words(child))))) continue;
    const text = words(el), hit = RAW.find(re => re.test(text));
    if (hit) { add('raw-note-in-value', el, `"${text.match(hit)[0]}" sits inside a shown value: show the value; a note goes in a muted line under it or a fold ("${text.slice(0, 70)}")`); }
  }
  // 2. Long lists fold: a value of many items as one paragraph, or a row of many chips with no "+N more" / "Show all".
  const ownWords = el => [...el.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join(' ').replace(/\s+/g, ' ').trim();
  for (const el of root.querySelectorAll('dd, p, span, div, li, td')) {
    if (!visible(el) || el.closest(READ_ONLY_SKIP) || el.children.length > 2 || ownWords(el).length < words(el).length * 0.6) continue;   // the element that holds the words, never a container
    const items = words(el).split(/\s*[,;·]\s*/).filter(part => part && part.length <= 40);
    if (items.length >= limits.listItems) add('long-list-unfolded', el, `${items.length} items written out in one paragraph: show the first few as chips and "+N more" ("${words(el).slice(0, 60)}…")`);
  }
  for (const row of root.querySelectorAll('.read-values, .chip-row, .chips')) {
    if (!visible(row)) continue;
    const chips = [...row.querySelectorAll('.chip-tag, .chip-button, .ui-tag')].filter(visible);
    const folds = [...row.parentElement.querySelectorAll('button, a')].some(control => visible(control) && /^\+\d+|more|show all/i.test(words(control)));
    if (chips.length > limits.chips && !folds) add('long-list-unfolded', row, `${chips.length} chips in a row with no "+N more": fold the rest`);
  }
  // 5. Buttons: a normal height, words on one line; one primary per card.
  const BUTTONS = 'button.primary, button.secondary, button.ghost, button.danger, button.danger-outline';
  const NOT_A_BUTTON_ROW = '.choice-cards, .service-card, .settings-nav, .segmented, .chip-row, .tabs, .ui-menu, .composer-tools';
  const primaries = new Map();
  for (const button of root.querySelectorAll(BUTTONS)) {
    if (!visible(button) || button.closest(NOT_A_BUTTON_ROW)) continue;
    const range = document.createRange();
    range.selectNodeContents(button);
    const lines = new Set([...range.getClientRects()].filter(rect => rect.width > 1).map(rect => Math.round(rect.top))).size;
    const height = Math.round(button.getBoundingClientRect().height);
    if (height > limits.buttonHeight || lines > 1) add('fat-button', button, `"${words(button)}" is ${height}px tall on ${lines} line(s) (at most ${limits.buttonHeight}px, one line): give it room, never wrap its words`);
    if (button.matches('button.primary') && !button.disabled) { const card = cardOf(button); primaries.set(card, [...(primaries.get(card) || []), button]); }
  }
  for (const [card, list] of primaries) if (card && list.length > 1) add('many-primaries', list[1], `${list.length} filled orange buttons in one card (${list.map(words).join(', ')}): one primary, the others secondary`);
  // 7. One "Note for the AI" fold per card.  8. One row per field: a label shown twice in a card is a duplicate.
  const notes = new Map(), labels = new Map();
  for (const summary of root.querySelectorAll('summary')) {
    if (visible(summary) && /^notes? for the ai\b/i.test(words(summary))) { const card = cardOf(summary); notes.set(card, (notes.get(card) || 0) + 1); }
  }
  for (const [card, count] of notes) if (card && count > 1) add('many-ai-notes', card, `${count} "Note for the AI" folds in one card: one per card`);
  for (const label of root.querySelectorAll('dt, .edit-label, h5')) {
    if (!visible(label) || label.closest('.card-editor') && !label.closest('.is-editing')) continue;
    const card = cardOf(label), key = words(label).toLowerCase().replace(/[:?]$/, '');
    if (!card || !key) continue;
    const seen = labels.get(card) || new Set();
    if (seen.has(key)) add('duplicate-field', label, `"${words(label)}" is shown twice in one card: one row per field`);
    seen.add(key);
    labels.set(card, seen);
  }
  // 7b. Modern controls (owner, 18 Oct 2026: "I like more card picker than the selectbox/dropdown"): a menu of a few choices is a card picker, segmented or chips;
  //     a <select> is only for a long list (country, currency).
  for (const select of root.querySelectorAll('select:not([data-long-list])')) {   // a searchable menu (.select-search) is the long-list form the rule allows
    if (!visible(select) || select.closest('.select-search')) continue;
    const options = [...select.options].filter(option => option.value !== '' && !option.disabled).length;
    if (options > 0 && options <= limits.selectOptions) add('small-select', select, `a menu of ${options} choices (${[...select.options].map(option => option.text).slice(0, 4).join(', ')}…): use a card picker, segmented buttons or chips`);
  }
  // 4. Now vs Proposed: told apart by colour, not only by weight or grey (both still readable).
  const rgb = value => (String(value).match(/[\d.]+/g) || []).map(Number);
  const colourful = el => { const style = getComputedStyle(el); return [style.color, style.backgroundColor, style.borderLeftColor].some(value => { const [r, g, b, a = 1] = rgb(value); return a > 0.1 && Math.max(r, g, b) - Math.min(r, g, b) > 40; }); };
  for (const now of root.querySelectorAll('div, p, li')) {
    if (!visible(now) || !/^now:/i.test(words(now)) || now.children.length > 4) continue;
    const proposed = [...now.parentElement.children].find(other => other !== now && /^proposed:/i.test(words(other)));
    if (proposed && !colourful(now) && !colourful(proposed)) add('flat-compare', proposed, 'Now and Proposed differ only by grey vs bold: give the proposal its colour (a tinted row or an accent edge)');
  }
  return found;
}

// Screens that broke a rule before it was written (18 Oct 2026), with the session fixing each: `${view}|${kind}|${card}` -> who. Shrink-only: a fixed screen
// comes off (the test counts them), and a new screen is never added.
export const KNOWN_LEFT = {
  // The design-system page's "Value → control" section draws answerControl (question-control*.js): its period, net/gross, unit and few-option menus are selects.
  'value-control|small-select|page': 'the editors session (Availability, Work eligibility, answer kinds) proposed by job-pilotto-75',
};

// The journey's verdict: a known screen is a warning that names who fixes it; anything new is severe.
export function judge(findings, known = KNOWN_LEFT) {
  return findings.map(item => {
    const who = known[`${item.view}|${item.kind}|${item.card}`];
    return who ? {...item, severity: 'warning', detail: `${item.detail} (known, being fixed: ${who})`} : item;
  });
}
