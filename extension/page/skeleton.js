// What a control is made of, without what it says: the first step of learning from forms we could not read (docs: Notion
// "Self-improving form filling"). A control's skeleton is its tags, roles and aria flags, with class names reduced to their
// words (build hashes dropped). It never holds text, values, placeholders, ids or addresses, so the same widget on two sites
// has the same fingerprint, and nothing a person typed can leave the page. Also loaded by the tests (module.exports).
(() => {
  // Attributes that say how a control behaves. Not value, placeholder, name, id, href, title or any text.
  const ATTRS = ['role', 'type', 'aria-pressed', 'aria-checked', 'aria-expanded', 'aria-haspopup', 'aria-autocomplete',
    'aria-selected', 'aria-multiselectable', 'aria-orientation', 'contenteditable', 'required', 'multiple', 'inputmode'];
  const STATE = new Set(['aria-pressed', 'aria-checked', 'aria-expanded', 'aria-selected']);
  const MAX_DEPTH = 4, MAX_CHILDREN = 12, MAX_CLASSES = 6;

  // "_yesno_1e3gg_148" -> "yesno"; "css-1x2y3z", "sc-bdVaJa", "a1b2c3d" -> dropped; "ashby-form-input-yesno" stays.
  function classWords(el) {
    const raw = typeof el.className === 'string' ? el.className : String(el.getAttribute?.('class') || '');
    const words = new Set();
    for (const token of raw.split(/\s+/).filter(Boolean)) {
      const module = /^_?([A-Za-z][A-Za-z0-9-]*?)_[a-z0-9]{4,8}(?:_\d+)?$/.exec(token);
      const word = module ? module[1] : token;
      if (/^(css|sc|jsx|emotion|svelte|chakra|mui|Mui)-?[A-Za-z0-9]*$/.test(word) && /\d/.test(word)) continue;
      if (/^[a-z]{0,2}\d[a-z0-9]{3,}$/i.test(word) || word.length < 3 || word.length > 40) continue;
      words.add(word.toLowerCase());
    }
    return [...words].sort().slice(0, MAX_CLASSES);
  }

  function node(el, depth) {
    const attrs = {};
    for (const name of ATTRS) {
      const value = el.getAttribute?.(name);
      if (value === null || value === undefined) continue;
      // What kind of thing it is stays; whether it is pressed, checked, open or selected right now does not.
      attrs[name] = STATE.has(name) || !(name === 'type' || name === 'role' || name.startsWith('aria-')) ? '' : String(value).slice(0, 24);
    }
    const kids = depth >= MAX_DEPTH ? [] : [...(el.children || [])].slice(0, MAX_CHILDREN).map(child => node(child, depth + 1));
    return {t: String(el.tagName || '').toLowerCase(), a: attrs, c: classWords(el), k: kids};
  }
  const skeleton = el => node(el, 0);

  // Canonical text of a skeleton; repeated identical siblings collapse to "*2", so a 2-option and a 3-option group differ
  // only by that count.
  function canonical(n) {
    const own = `${n.t}${Object.entries(n.a).map(([k, v]) => `[${k}${v ? `=${v}` : ''}]`).join('')}${n.c.length ? `.${n.c.join('.')}` : ''}`;
    const parts = [];
    for (const kid of n.k.map(canonical)) {
      const last = parts[parts.length - 1];
      if (last && last.text === kid) last.count++; else parts.push({text: kid, count: 1});
    }
    return parts.length ? `${own}(${parts.map(p => p.count > 1 ? `${p.text}*${p.count}` : p.text).join(',')})` : own;
  }
  // A short, stable name for a structure (cyrb53).
  function hash(text) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  const fingerprint = n => hash(canonical(n));

  // Interactive widgets that are not a native input/textarea/select, found by what they do. `shown(el)` says if it is visible.
  const WIDGETS = [
    ['switch', '[role=switch]'],
    ['radiogroup', '[role=radiogroup]'],
    ['listbox', '[role=listbox]'],
    ['slider', '[role=slider]'],
    ['custom-select', 'button[aria-haspopup=listbox], div[role=combobox], button[role=combobox]'],
    ['rich-text', '[contenteditable=true], div[role=textbox]'],
  ];
  function widgets(root, shown = () => true) {
    const found = [];
    for (const [kind, selector] of WIDGETS) {
      for (const el of root.querySelectorAll(selector)) if (shown(el)) found.push({el, kind});
    }
    // A group of two or more pressable buttons under one parent (Yes/No, Male/Female, size pickers).
    const pairs = new Map();
    for (const button of root.querySelectorAll('button[aria-pressed], [role=radio], button[aria-checked]')) {
      if (!shown(button) || !button.parentElement) continue;
      if (!pairs.has(button.parentElement)) pairs.set(button.parentElement, 0);
      pairs.set(button.parentElement, pairs.get(button.parentElement) + 1);
    }
    for (const [el, count] of pairs) if (count >= 2) found.push({el, kind: 'toggle-group'});
    return found;
  }

  const api = {skeleton, canonical, fingerprint, classWords, widgets};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.__jobPilottoSkeleton = api;
})();
