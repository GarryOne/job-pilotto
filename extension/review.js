// A ring on every application form (bottom right): how many required fields are still empty, green with a ✓
// when nothing is left and you can submit. Click it for the list; click an item to go to that field.
// With the Job Pilotto app open it also keeps the app's session page in step: the app says which fields to watch
// (the agreements only you may tick) and gets their state back, and "Open the form to tick it" in the app scrolls
// here to that field. Read only: it never types, ticks or clicks anything in the form.
(() => {
  if (window.__jobPilottoReview) return;
  window.__jobPilottoReview = true;

  const MIN_FIELDS = 3;
  const SKIP = ['hidden', 'submit', 'button', 'reset', 'search', 'image'];
  const AGREE = /agree|consent|acknowledg|terms|privacy|policy|arbitrat|certif|attest|pledge/i;
  const clean = text => String(text || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim();
  const norm = text => clean(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');

  // The question a field answers: its label, legend, aria-label or the nearest heading-like text above it.
  function question(el) {
    const byIds = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent).filter(Boolean).join(' ');
    const own = byIds || el.getAttribute('aria-label') || Array.from(el.labels || [], label => label.textContent).join(' ');
    const legend = el.closest('fieldset')?.querySelector('legend')?.textContent;
    if (['checkbox', 'radio'].includes(el.type) && legend) return clean(legend);
    if (clean(own)) return clean(own);
    if (legend) return clean(legend);
    let box = el.parentElement;
    for (let i = 0; i < 4 && box; i++, box = box.parentElement) {
      const text = clean(box.querySelector('label, legend, [class*=label], [class*=question]')?.textContent);
      if (text) return text;
    }
    return clean(el.name || el.id);
  }
  const required = el => el.required || el.getAttribute('aria-required') === 'true' ||
    /\*\s*$/.test(String(el.labels?.[0]?.textContent || el.closest('fieldset')?.querySelector('legend')?.textContent || '').trim());
  const comboFilled = el => !!el.closest('[class*=container]')?.querySelector('[class*=single-value], [class*=multi-value]');

  // Every question on the page, once: radios and checkboxes of one question count as one.
  function fields() {
    const groups = new Map();
    for (const el of document.querySelectorAll('input, textarea, select')) {
      if (SKIP.includes(el.type) || el.disabled || el.getAttribute('aria-hidden') === 'true' || !visible(el)) continue;
      if (el.closest('#jobpilotto-review-host')) continue;
      const grouped = ['checkbox', 'radio'].includes(el.type) && el.closest('fieldset');
      const key = grouped ? `group:${question(el)}` : el.type === 'radio' ? `radio:${el.name}` : el;
      const filled = el.type === 'file' ? !!el.files?.length : el.getAttribute('role') === 'combobox' ? comboFilled(el)
        : ['checkbox', 'radio'].includes(el.type) ? el.checked : !!String(el.value || '').trim();
      const entry = groups.get(key) || {el, label: question(el), required: false, filled: false};
      entry.required ||= required(el);
      entry.filled ||= filled;
      groups.set(key, entry);
    }
    // A CV some sites show only as a file name once attached (the file input is gone): count it as filled.
    for (const entry of groups.values()) {
      if (!entry.filled && entry.el.type === 'file') {
        let box = entry.el;
        for (let i = 0; i < 4 && box.parentElement; i++) box = box.parentElement;
        entry.filled = /\S+\.(pdf|docx?|rtf|txt|odt)\b/i.test(box.textContent || '');
      }
    }
    return [...groups.values()];
  }
  // A field the app asked about, by its question: exact, then one containing the other.
  function find(label, list = fields()) {
    const wanted = norm(label);
    if (!wanted) return null;
    return list.find(f => norm(f.label) === wanted) || list.find(f => norm(f.label).includes(wanted) || (norm(f.label).length > 8 && wanted.includes(norm(f.label))));
  }

  // ---- the ring (in its own shadow root: the page's styles can't touch it, it can't touch the page) ----
  const host = Object.assign(document.createElement('div'), {id: 'jobpilotto-review-host'});
  host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483646;';
  const root = host.attachShadow({mode: 'open'});
  root.innerHTML = `<style>
    :host { all: initial; }
    .ring { width: 58px; height: 58px; border-radius: 50%; cursor: pointer; display: grid; place-items: center; position: relative;
      box-shadow: 0 6px 20px rgba(19,36,57,.28); font: 700 15px/1 system-ui, sans-serif; color: #132439; background: #fff; border: 0; padding: 0; }
    .ring::before { content: ''; position: absolute; inset: 0; border-radius: 50%;
      background: conic-gradient(var(--tone) calc(var(--done) * 1%), #e7ecf2 0); -webkit-mask: radial-gradient(circle, transparent 21px, #000 22px); }
    .ring.ready { --tone: #1f9d55; color: #fff; background: #1f9d55; }
    .ring.ready::before { display: none; }
    .ring small { display: block; font-weight: 600; font-size: 9px; color: #5b6b7f; margin-top: 2px; text-align: center; }
    .ring.ready small { color: #fff; }
    .panel { position: absolute; right: 0; bottom: 70px; width: 290px; max-height: 50vh; overflow: auto; background: #fff; border-radius: 12px;
      box-shadow: 0 10px 34px rgba(19,36,57,.3); font: 13px/1.4 system-ui, sans-serif; color: #132439; padding: 12px 14px; }
    .panel b { display: block; margin-bottom: 6px; font-size: 13px; }
    .panel p { margin: 0 0 8px; color: #5b6b7f; font-size: 12px; }
    .item { display: flex; gap: 8px; padding: 7px 8px; border-radius: 8px; cursor: pointer; align-items: flex-start; }
    .item:hover { background: #f1f4f8; }
    .item i { font-style: normal; flex: none; }
    .link { color: #5b6b7f; font-size: 11px; margin-top: 8px; }
    [hidden] { display: none !important; }
  </style>
  <div class="panel" hidden></div>
  <button class="ring" title="Job Pilotto: what's left before you submit"></button>`;
  const ring = root.querySelector('.ring'), panel = root.querySelector('.panel');
  let shown = [], linked = false;

  function flash(el) {
    el.scrollIntoView({behavior: 'smooth', block: 'center'});
    const target = el.closest('fieldset') || el;
    const before = target.style.outline, offset = target.style.outlineOffset;
    target.style.outline = '3px solid #f07014';
    target.style.outlineOffset = '4px';
    setTimeout(() => { target.style.outline = before; target.style.outlineOffset = offset; }, 3500);
    if (!['checkbox', 'radio', 'file'].includes(el.type)) el.focus({preventScroll: true});
  }
  function draw() {
    const list = fields();
    if (list.length < MIN_FIELDS) { host.remove(); return null; }
    if (!host.isConnected) document.documentElement.append(host);
    const needed = list.filter(f => f.required);
    shown = needed.filter(f => !f.filled);
    const total = needed.length, left = shown.length;
    const ready = total > 0 && left === 0;
    ring.classList.toggle('ready', ready);
    ring.style.setProperty('--tone', left ? '#f07014' : '#1f9d55');
    ring.style.setProperty('--done', total ? Math.round(100 * (total - left) / total) : 0);
    ring.innerHTML = ready ? '✓<small>Ready</small>' : total ? `${left}<small>left</small>` : '–';
    ring.title = ready ? 'Job Pilotto: every required field is filled. Review, then submit yourself.'
      : `Job Pilotto: ${left} required field${left === 1 ? '' : 's'} left`;
    if (!panel.hidden) fillPanel();
    return {list, left, total};
  }
  function fillPanel() {
    panel.replaceChildren();
    const head = Object.assign(document.createElement('b'), {textContent: shown.length ? `${shown.length} left before you can submit` : 'Ready to submit'});
    const note = Object.assign(document.createElement('p'), {textContent: shown.length ? 'Click one to go to it.' : 'Every required field is filled. Check the answers, then press Submit yourself.'});
    panel.append(head, note);
    for (const field of shown) {
      const row = Object.assign(document.createElement('div'), {className: 'item'});
      row.append(Object.assign(document.createElement('i'), {textContent: AGREE.test(field.label) ? '⚖️' : '○'}),
        Object.assign(document.createElement('span'), {textContent: field.label.slice(0, 140) || 'A required field'}));
      row.onclick = () => flash(field.el);
      panel.append(row);
    }
    panel.append(Object.assign(document.createElement('div'), {className: 'link',
      textContent: linked ? 'In step with the Job Pilotto app' : 'Job Pilotto never submits: you do'}));
  }
  ring.onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) fillPanel(); };

  // ---- in step with the app (through the extension's background: extension/background.js) ----
  let watch = [], timer = null, busy = false;
  async function sync() {
    const state = draw();
    if (!state || busy || !chrome.runtime?.id) return;
    busy = true;
    try {
      const payload = {url: location.href, title: document.title, left: state.left, total: state.total,
        watch: watch.map(({id, label}) => { const field = find(label, state.list); return {id, filled: field ? field.filled : null}; })};
      const reply = await chrome.runtime.sendMessage({type: 'review', payload});
      linked = !!reply?.matched;
      const before = JSON.stringify(watch);
      watch = Array.isArray(reply?.watch) ? reply.watch : [];
      for (const command of reply?.commands || []) {
        const field = find(command.focus, state.list);
        if (field) flash(field.el);
      }
      if (JSON.stringify(watch) !== before) setTimeout(sync, 50);  // report the new fields' state at once
    } catch { linked = false; } finally { busy = false; }
  }
  const soon = () => { clearTimeout(timer); timer = setTimeout(sync, 400); };
  document.addEventListener('input', soon, true);
  document.addEventListener('change', soon, true);
  new MutationObserver(soon).observe(document.documentElement, {childList: true, subtree: true});
  setInterval(sync, 4000);  // picks up "show me this field" from the app, and fields that change without events
  sync();
})();
