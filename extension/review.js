// The Job Pilotto panel, only on a tab the desktop app opened (bottom right). Collapsed: a pill with a progress ring and what's
// left ("3 left", green "Ready to submit"). Open: the job, what Claude is doing on it, the progress, one Fill button,
// what's left for you (click one: the page scrolls to it), and Open in Job Pilotto.
// App first: the job, its Apply with Claude session and the form's state are shared with the Job Pilotto app both
// ways (the agreements you tick here are ticked off there; "Show it in the form" there scrolls here). Without the
// app it still shows the form's progress, and fills through the extension's own connection.
// The panel itself never types, ticks or clicks anything in the form: filling goes through the extension's fill.
(() => {
  // Once per page, but a copy left behind by an extension reload (its chrome.runtime is gone) gives way to the new one.
  if (window.__jobPilottoReviewAlive?.()) return;
  window.__jobPilottoReviewAlive = () => !!chrome.runtime?.id;
  const send = message => (chrome.runtime?.id ? chrome.runtime.sendMessage(message) : Promise.reject(new Error('reloaded')));
  // The desktop app is the only way onto a page. Anywhere else this script was injected (an old "every site"
  // registration, a reload) it draws nothing and listens for nothing.
  send({type: 'panelAllowed'}).then(answer => { if (answer?.ok) mount(); }).catch(() => {});

  function mount() {
  document.getElementById('jobpilotto-review-host')?.remove();

  const MIN_FIELDS = 3;
  const SKIP = ['hidden', 'submit', 'button', 'reset', 'search', 'image'];
  const AGREE = /agree|consent|acknowledg|terms|privacy|policy|arbitrat|certif|attest|pledge/i;
  const clean = text => String(text || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim();
  const norm = text => clean(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');

  // ---- reading the form (read only) ----
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
  // A custom dropdown (react-select) shows its answer in a sibling of the input, not inside the input's own container:
  // look in the control around it (input < input-container < value-container < control).
  const comboFilled = el => {
    for (let box = el.parentElement, i = 0; box && i < 4; box = box.parentElement, i++)
      if (box.querySelector('[class*=single-value], [class*=multi-value]')) return true;
    return false;
  };
  // Some sites empty the file input once a file is attached and show its name instead, in a chip next to or around the input.
  // Looked for in the field's own area: up through its containers, stopping before one that also holds another field.
  const FILE_NAME = /\S+\.(pdf|docx?|rtf|txt|odt)\b/i;
  function showsFileName(input) {
    let box = input;
    for (let i = 0; i < 10 && box.parentElement; i++) {
      const up = box.parentElement;
      const another = [...up.querySelectorAll('input, textarea, select')].some(other => other !== input && other.type !== 'file' && other.type !== 'hidden' && visible(other));
      if (another) break;
      box = up;
      if (FILE_NAME.test(box.textContent || '')) return true;
    }
    return false;
  }
  function fields() {
    const groups = new Map();
    for (const el of document.querySelectorAll('input, textarea, select')) {
      if (SKIP.includes(el.type) || el.disabled || el.getAttribute('aria-hidden') === 'true' || !visible(el)) continue;
      const grouped = ['checkbox', 'radio'].includes(el.type) && el.closest('fieldset');
      const key = grouped ? `group:${question(el)}` : el.type === 'radio' ? `radio:${el.name}` : el;
      const filled = el.type === 'file' ? !!el.files?.length : el.getAttribute('role') === 'combobox' ? comboFilled(el)
        : ['checkbox', 'radio'].includes(el.type) ? el.checked : !!String(el.value || '').trim();
      const entry = groups.get(key) || {el, label: question(el), required: false, filled: false, ai: false};
      entry.required ||= required(el);
      entry.ai ||= el.hasAttribute('data-jobpilotto-ai');
      entry.filled ||= filled;
      groups.set(key, entry);
    }
    for (const entry of groups.values()) {  // a CV some sites show only as a file name once attached
      if (!entry.filled && entry.el.type === 'file') entry.filled = showsFileName(entry.el);
    }
    // Yes/No questions drawn as two toggle buttons (Ashby: aria-pressed, with a visually hidden checkbox no one sees): one field,
    // filled when one of the two is pressed, required as its title says.
    const pairs = new Map();
    for (const button of document.querySelectorAll('button[aria-pressed]')) {
      if (!/^(yes|no)$/i.test((button.textContent || '').trim()) || !visible(button)) continue;
      if (!pairs.has(button.parentElement)) pairs.set(button.parentElement, []);
      pairs.get(button.parentElement).push(button);
    }
    for (const [box, buttons] of pairs) {
      if (buttons.length < 2) continue;
      let title = null;
      for (let up = box.parentElement, i = 0; up && i < 5 && !title; up = up.parentElement, i++) {
        const found = up.querySelector('label, legend, [class*=title], [class*=heading]');
        if (found && clean(found.textContent)) title = found;
      }
      if (!title) continue;
      groups.set(box, {el: box, label: clean(title.textContent), ai: false,
        required: /required/i.test(title.className) || /\*\s*$/.test(title.textContent || ''),
        filled: buttons.some(button => button.getAttribute('aria-pressed') === 'true')});
    }
    return [...groups.values()];
  }
  function find(label, list = fields()) {
    const wanted = norm(label);
    if (!wanted) return null;
    return list.find(f => norm(f.label) === wanted) || list.find(f => norm(f.label).includes(wanted) || (norm(f.label).length > 8 && wanted.includes(norm(f.label))))
      || byWords(wanted, list);
  }
  // Claude shortens questions ("Rationale or evidence for the high school selections" for "Please share your rationale
  // or evidence for the high school performance selections above…"): the field sharing most of its words, if at
  // least 70% of them and 3 or more.
  const WORD = /[\p{L}\p{N}]{3,}/gu;
  const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'are', 'with', 'this', 'that', 'what', 'have', 'did', 'how', 'please', 'which']);
  function byWords(wanted, list) {
    const words = [...new Set(wanted.match(WORD) || [])].filter(word => !STOP.has(word));
    if (words.length < 2) return null;
    let best = null, bestShare = 0, bestCount = 0;
    for (const field of list) {
      const label = norm(field.label);
      const count = words.filter(word => label.includes(word)).length;
      if (count / words.length > bestShare) { best = field; bestShare = count / words.length; bestCount = count; }
    }
    return bestShare >= 0.7 && bestCount >= 3 ? best : null;
  }
  // The page's highlight for fields (one stylesheet, added once, shared by fill.js and review.js): a soft amber ring
  // and glow instead of a hard border or outline. "review": an answer the AI wrote (pulses 3 times, then stays soft);
  // "flash": the field the panel or the app pointed at (pulses, removed after a few seconds).
  const glowStyle = () => {
    if (document.getElementById('jobpilotto-glow-style')) return;
    const style = document.createElement('style');
    style.id = 'jobpilotto-glow-style';
    style.textContent = `
      @keyframes jobpilotto-pulse { 0%, 100% { box-shadow: 0 0 0 2px rgba(245,158,11,.45), 0 0 10px 2px rgba(245,158,11,.18); }
        50% { box-shadow: 0 0 0 3px rgba(245,158,11,.75), 0 0 22px 6px rgba(245,158,11,.35); } }
      .jobpilotto-review { box-shadow: 0 0 0 2px rgba(245,158,11,.45), 0 0 10px 2px rgba(245,158,11,.18) !important;
        animation: jobpilotto-pulse 1.4s ease-in-out 3; transition: box-shadow .3s ease; }
      .jobpilotto-flash { box-shadow: 0 0 0 3px rgba(240,112,20,.8), 0 0 24px 6px rgba(240,112,20,.35) !important;
        animation: jobpilotto-pulse 1s ease-in-out 3; transition: box-shadow .3s ease; }
      @media (prefers-reduced-motion: reduce) { .jobpilotto-review, .jobpilotto-flash { animation: none; } }`;
    document.head.append(style);
  };
  function flash(el) {
    el.scrollIntoView({behavior: 'smooth', block: 'center'});
    const target = el.closest('fieldset') || el;
    glowStyle();
    target.classList.remove('jobpilotto-flash');
    void target.offsetWidth;  // restart the pulse when the same field is shown again
    target.classList.add('jobpilotto-flash');
    setTimeout(() => target.classList.remove('jobpilotto-flash'), 3500);
    // The cursor goes into text fields only: a dropdown would open its menu, a box would look ticked-by-us.
    if (!['checkbox', 'radio', 'file'].includes(el.type) && el.getAttribute('role') !== 'combobox' && el.tagName !== 'SELECT') el.focus({preventScroll: true});
  }

  // ---- the panel (its own shadow root: the page's styles can't touch it, it can't touch the page) ----
  const host = Object.assign(document.createElement('div'), {id: 'jobpilotto-review-host'});
  host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483646;';
  const root = host.attachShadow({mode: 'open'});
  root.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    .jp { --navy: #132439; --ink: #182537; --muted: #5b6b80; --line: #e2e8f0; --soft: #f5f7fb; --signal: #d9540b; --signal-2: #f07014;
      --good: #1f9d55; --good-soft: #e7f6ee; --warn: #9a6200; --warn-soft: #fdf4e4; --info: #165bba; --info-soft: #eaf1fb;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: var(--ink);
      display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
    button { font: inherit; cursor: pointer; border: 0; }
    /* the pill (collapsed) */
    .pill { display: flex; align-items: center; gap: 10px; padding: 6px 14px 6px 6px; border-radius: 999px; background: #fff;
      box-shadow: 0 6px 22px rgba(19,36,57,.22), 0 0 0 1px rgba(19,36,57,.06); color: var(--ink); }
    .pill:hover { box-shadow: 0 8px 26px rgba(19,36,57,.28), 0 0 0 1px rgba(19,36,57,.1); }
    .ring { --done: 0; --tone: var(--signal-2); width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; flex: none;
      background: conic-gradient(var(--tone) calc(var(--done) * 1%), #e7ecf2 0); font-weight: 700; font-size: 13px; }
    .ring span { width: 28px; height: 28px; border-radius: 50%; background: #fff; display: grid; place-items: center; }
    .ready .ring { --tone: var(--good); background: var(--good); color: #fff; }
    .ready .ring span { background: var(--good); }
    .pill b { font-size: 13px; }
    .pill small { display: block; color: var(--muted); font-size: 11px; font-weight: 500; }
    .ready .pill b { color: var(--good); }
    /* the card (open) */
    .card { width: 348px; max-height: min(640px, calc(100vh - 110px)); display: flex; flex-direction: column; background: #fff;
      border-radius: 16px; overflow: hidden; box-shadow: 0 18px 50px rgba(19,36,57,.3), 0 0 0 1px rgba(19,36,57,.06); }
    .head { display: flex; align-items: center; gap: 8px; padding: 11px 14px; background: var(--navy); color: #fff; }
    .mark { width: 22px; height: 22px; border-radius: 6px; background: var(--signal); display: grid; place-items: center; font: 800 10px/1 system-ui; }
    .head b { font-size: 13px; }
    .head .x { margin-left: auto; background: transparent; color: #b9c8dc; font-size: 18px; line-height: 1; padding: 2px 4px; border-radius: 6px; }
    .head .x:hover { color: #fff; background: rgba(255,255,255,.1); }
    .body { padding: 14px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
    .job-title { font-weight: 650; font-size: 14px; line-height: 1.3; }
    .job-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; color: var(--muted); margin-top: 3px; }
    .tag { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600;
      background: var(--info-soft); color: var(--info); }
    .tag.good { background: var(--good-soft); color: var(--good); } .tag.warn { background: var(--warn-soft); color: var(--warn); }
    .tag.dot::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .claude { display: flex; gap: 8px; align-items: flex-start; padding: 9px 10px; border-radius: 10px; background: var(--soft); color: var(--ink); font-size: 12.5px; }
    .claude i { font-style: normal; flex: none; }
    .progress-line { display: flex; align-items: baseline; justify-content: space-between; }
    .progress-line b { font-size: 20px; letter-spacing: -.01em; }
    .progress-line span { color: var(--muted); font-size: 12px; }
    .bar { height: 6px; border-radius: 999px; background: #e7ecf2; overflow: hidden; margin-top: 6px; }
    .bar i { display: block; height: 100%; width: 0; background: var(--signal-2); border-radius: 999px; transition: width .3s; }
    .ready .bar i { background: var(--good); }
    .primary { width: 100%; padding: 10px; border-radius: 10px; background: var(--signal); color: #fff; font-weight: 650;
      display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; }
    .primary:hover { background: #c44a08; }
    .primary:disabled { opacity: .6; cursor: default; }
    .primary .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* Working: the button itself says what's happening, at full colour, with a white spinner. */
    .primary.is-busy, .primary.is-busy:disabled { opacity: 1; cursor: progress; background: var(--signal); font-weight: 600; font-size: 12.5px; }
    .primary .spin { display: none; width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,.35);
      border-top-color: #fff; animation: spin .8s linear infinite; flex: none; }
    .primary.is-busy .spin { display: block; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .note { padding: 9px 10px; border-radius: 10px; background: var(--warn-soft); color: var(--warn); font-size: 12.5px; }
    .note button { margin-top: 6px; background: transparent; color: var(--signal); font-weight: 650; padding: 0; }
    h4 { margin: 0 0 4px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
    .item { display: flex; gap: 9px; align-items: flex-start; width: 100%; text-align: left; padding: 7px 8px; border-radius: 8px; background: transparent; color: var(--ink); }
    .item:hover { background: var(--soft); }
    .item i { font-style: normal; flex: none; width: 16px; text-align: center; color: var(--muted); }
    .item .go { margin-left: auto; color: var(--muted); }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .secondary { padding: 7px 10px; border-radius: 9px; background: #fff; color: var(--ink); border: 1px solid var(--line); font-weight: 600; font-size: 12px; }
    .secondary:hover { background: var(--soft); }
    .foot { display: flex; align-items: center; gap: 6px; padding: 9px 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11.5px; }
    .foot::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
    .foot.on::before { background: var(--good); }
    [hidden] { display: none !important; }
  </style>
  <div class="jp">
    <div class="card" hidden>
      <div class="head"><span class="mark">JP</span><b>Job Pilotto</b><button class="x" title="Hide">×</button></div>
      <div class="body">
        <div class="job" hidden><div class="job-title"></div><div class="job-meta"></div></div>
        <div class="claude" hidden><i>🤖</i><span></span></div>
        <div class="progress"><div class="progress-line"><b></b><span></span></div><div class="bar"><i></i></div></div>
        <div class="fill-box"><button class="primary fill"><i class="spin"></i><span class="label">Fill this form</span></button></div>
        <div class="note" hidden><span></span><button class="anyway" hidden>Fill anyway</button></div>
        <div class="left" hidden><h4>Left for you</h4><div class="list"></div></div>
        <div class="actions">
          <button class="secondary open-app" hidden>Open in Job Pilotto</button>
        </div>
      </div>
      <div class="foot">Checking the connection…</div>
    </div>
    <button class="pill" title="Job Pilotto"><span class="ring"><span></span></span><div><b></b><small></small></div></button>
  </div>`;
  const $ = selector => root.querySelector(selector);
  const jp = $('.jp'), card = $('.card'), pill = $('.pill');
  let open = false, shown = [], job = null, session = null, connection = null, filling = false, userMoved = false;

  const setOpen = value => { open = value; card.hidden = !open; if (open) render(); };
  pill.onclick = () => { userMoved = true; setOpen(!open); };
  $('.x').onclick = () => { userMoved = true; setOpen(false); };

  // ---- drawing ----
  function render(list = fields()) {
    if (list.length < MIN_FIELDS) { host.remove(); return null; }
    if (!host.isConnected) document.documentElement.append(host);
    // An answer Claude wrote that is now empty (marked amber) still needs you, required or not.
    const needed = list.filter(f => f.required || f.ai);
    shown = needed.filter(f => !f.filled);
    const total = needed.length, left = shown.length, ready = total > 0 && left === 0;
    const done = total ? Math.round(100 * (total - left) / total) : 0;
    jp.classList.toggle('ready', ready);
    $('.ring').style.setProperty('--done', done);
    $('.ring span').textContent = ready ? '✓' : total ? String(left) : '–';
    $('.pill b').textContent = ready ? 'Ready to submit' : total ? `${left} left` : 'Job Pilotto';
    $('.pill small').textContent = (job?.company || session?.company) ? (job?.company || session?.company) : ready ? 'Review, then submit' : 'required fields';
    // A fill running (this panel's, Claude's, the popup's) or over: a field filled after it is yours.
    const busy = filling || (session?.live && session.status === 'running') || $('.fill').classList.contains('is-busy');
    const over = filledOnce || ['done', 'input'].includes(session?.status);
    if (!open) return {list, left, total, busy, over};
    // job + Claude
    const title = job?.title || session?.title, company = job?.company || session?.company;
    $('.job').hidden = !title;
    $('.job-title').textContent = title || '';
    $('.job-meta').replaceChildren(...[company && Object.assign(document.createElement('span'), {textContent: company}),
      job?.stage && Object.assign(document.createElement('span'), {className: `tag ${/applied/i.test(job.stage) ? 'good' : ''}`, textContent: job.stage})].filter(Boolean));
    const claude = session?.kind === 'form' ? ''   // the Apply button's session: the extension fills it, there is no Claude to name
      : session?.live && session.status === 'running' ? `Claude is filling this form · ${session.note || 'working'}`
      : session?.live && session.status === 'input' ? 'Claude is waiting for you in Job Pilotto.'
      : session?.status === 'done' ? 'Claude filled this form. Review it, then submit it yourself.' : '';
    $('.claude').hidden = !claude;
    $('.claude span').textContent = claude;
    // progress
    $('.progress-line b').textContent = ready ? 'Ready to submit' : total ? `${total - left} of ${total}` : 'No required fields';
    $('.progress-line span').textContent = ready ? 'every required field is filled' : total ? 'required fields filled' : '';
    $('.bar i').style.width = `${ready ? 100 : done}%`;
    // fill (not while Claude is filling this form: it would fight it)
    const claudeFilling = session?.live && session.status === 'running';
    $('.fill-box').hidden = claudeFilling || (ready && !filling);  // nothing left to fill
    $('.fill').disabled = filling;
    // What's left for you, once the filling is over: before and during it, nearly every field is still to be filled
    // by the extension or Claude, not by you (the ring and the bar show the progress meanwhile).
    $('.left').hidden = !left || busy || !over;
    $('.list').replaceChildren(...shown.slice(0, 30).map(field => {
      const row = Object.assign(document.createElement('button'), {className: 'item'});
      row.append(Object.assign(document.createElement('i'), {textContent: AGREE.test(field.label) ? '⚖️' : '○'}),
        Object.assign(document.createElement('span'), {textContent: field.label.slice(0, 120) || 'A required field'}),
        Object.assign(document.createElement('span'), {className: 'go', textContent: '›'}));
      row.onclick = () => flash(field.el);
      return row;
    }));
    // actions + connection
    $('.open-app').hidden = !session;
    const foot = $('.foot');
    foot.classList.toggle('on', !!connection?.connected);
    foot.textContent = connection?.connected ? (connection.app ? (session ? 'In sync with Job Pilotto' : 'Connected to Job Pilotto') : 'Connected to your Worker')
      : connection ? (connection.why || 'Not connected: the form still fills from your settings') : 'Checking the connection…';
    return {list, left, total, busy, over};
  }

  // ---- actions ----
  // What the fill is doing, shown in the button. A fill started elsewhere (Claude's session, the popup) sends steps but
  // no end: the button comes back a few seconds after its last step.
  let stepTimer = null, filledOnce = false, stepped = false;
  function showStep(text) {
    stepped = true;
    const button = $('.fill');
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
    button.title = text;
    $('.fill .label').textContent = text;
    clearTimeout(stepTimer);
    if (!filling) stepTimer = setTimeout(endStep, 6000);
  }
  function endStep() {
    clearTimeout(stepTimer);
    const button = $('.fill');
    button.classList.remove('is-busy');
    button.removeAttribute('aria-busy');
    button.title = '';
    if (stepped) filledOnce = true;  // a fill ran here (this button, Claude's session or the popup) and is over
    $('.fill .label').textContent = filledOnce ? 'Fill again' : 'Fill this form';
    render();
  }
  async function fill(force = false) {
    filling = true;
    $('.note').hidden = true;
    showStep('Reading the form…');
    render();
    const result = await send({type: 'panelFill', url: session?.url || job?.url || location.href, force}).catch(error => ({ok: false, error: error.message}));
    filling = false;
    filledOnce = true;
    endStep();
    if (result?.ineligible) note(`Not filled: ${result.note}`, true);
    else if (!result?.ok) note(`Couldn't fill: ${result?.error || 'try again'}`);
    render();
  }
  function note(text, anyway = false) {
    $('.note').hidden = false;
    $('.note span').textContent = text;
    $('.anyway').hidden = !anyway;
  }
  $('.fill').onclick = () => fill();
  $('.anyway').onclick = () => fill(true);
  $('.open-app').onclick = () => session && send({type: 'panelOpenApp', session: session.id}).catch(() => {});
  // The extension's fill reports its steps here (instead of a floating box).
  chrome.runtime.onMessage.addListener((message, _, reply) => {
    if (message?.type !== 'panelStep') return false;
    if (!host.isConnected) { reply({shown: false}); return false; }
    if (message.text) { showStep(message.text); if (!open) setOpen(true); }
    else endStep();  // the fill is over: no step line left over a form that is ready
    reply({shown: true});
    return false;
  });

  // A fill already on a step when this panel appeared: show it here (the background removes its floating copy).
  send({type: 'panelStepNow'}).then(answer => { if (answer?.text && host.isConnected) { showStep(answer.text); if (!open) setOpen(true); } }).catch(() => {});

  // ---- in step with the app ----
  let watch = [], timer = null, busy = false, jobAsked = '';
  async function sync() {
    if (!chrome.runtime?.id) { host.remove(); clearInterval(tick); return; }  // this copy was replaced by a reload
    const state = render();
    if (!state || busy) return;
    busy = true;
    try {
      const payload = {url: location.href, title: document.title, left: state.left, total: state.total,
        missing: state.list.filter(f => f.required && !f.filled).slice(0, 30).map(f => String(f.label || 'A required field').slice(0, 120)),
        // What is filled, so the app can tick each field off as it happens (it keeps the time it first saw each one).
        // What is left, counted as the ring counts it: required, or an answer Claude wrote that is empty again.
        pending: state.list.filter(f => (f.required || f.ai) && !f.filled).slice(0, 30).map(f => String(f.label || 'A required field').slice(0, 120)),
        busy: !!state.busy, over: !!state.over,
        filled: state.list.filter(f => (f.required || f.ai) && f.filled).slice(0, 40).map(f => String(f.label || 'A required field').slice(0, 120)),
        watch: watch.map(({id, label}) => { const field = find(label, state.list); return {id, filled: field ? field.filled : null}; })};
      const reply = await send({type: 'review', payload});
      session = reply?.session || null;
      const before = JSON.stringify(watch);
      watch = Array.isArray(reply?.watch) ? reply.watch : [];
      // The app asked to see this form (and maybe one field): this tab comes forward, then the field.
      for (const command of reply?.commands || []) {
        // The app asked this page to reload itself: the repair for a page whose panel died with an older extension
        // instance (an uninstall/reinstall leaves it unable to answer). This panel is alive, so it can do it.
        if (command.reload) { location.reload(); return; }
        if (command.close) { send({type: 'panelCloseTab'}).catch(() => {}); return; }  // the application was cancelled in the app
        send({type: 'panelShowTab'}).catch(() => {});
        if (!open) setOpen(true);
        if (command.focus) {
          const field = find(command.focus, state.list);
          if (field) flash(field.el);
          send({type: 'focusResult', found: !!field}).catch(() => {});
        }
      }
      // The job once per page (and again when a session matched): title, stage, kit.
      const wanted = session?.url || location.href;
      // The job's details load on the side (Notion can be slow or busy): the check-in, and the app's "show this
      // form", never wait for them.
      if (jobAsked !== wanted) {
        jobAsked = wanted;
        send({type: 'panelJob', url: wanted}).catch(() => ({connected: false})).then(answer => {
          connection = answer;
          // The app answered with an error (Notion busy): ask again in 30 s instead of never on this page.
          if (connection?.retry) setTimeout(() => { if (jobAsked === wanted) jobAsked = ''; }, 30000);
          job = connection?.job || null;
          // Open by itself the first time on a job it knows (you can close it; it stays closed).
          if ((job || session) && !userMoved && !open) setOpen(true);
          render();
        });
      }
      render();
      if (JSON.stringify(watch) !== before) setTimeout(sync, 50);
    } catch { /* the app is closed: the panel still shows the form's progress */ } finally { busy = false; }
  }
  const soon = () => { clearTimeout(timer); timer = setTimeout(sync, 400); };
  document.addEventListener('input', soon, true);
  document.addEventListener('change', soon, true);
  // Was this form actually submitted? A submission is an event, and the page's own panel is the only thing that can
  // see it (the worker cannot read a page's events). The press is recorded, never sent by us: this listens, it does
  // not click. It is what lets the app mark a job Applied on evidence instead of on wording that looks like a
  // confirmation (1 Oct 2026: an unsubmitted job was marked Applied because a page said "thank you for applying").
  // A submit control, not an "Apply" link that only opens the form. The press is recorded. Marking waits
  // for the tab to land on another page, which the app then reads.
  const submitWords = /\b(submit|send application)\b/i;
  // Taken at the press, before the site navigates or replaces the form, so the later read can see what changed.
  const snapshot = () => {
    const clip = value => String(value || '').replace(/\s+/g, ' ').trim();
    const headings = [...document.querySelectorAll('h1, h2')].map(el => clip(el.innerText)).filter(Boolean).slice(0, 6);
    const inputs = [...document.querySelectorAll('input, textarea, select')].filter(el => el.type !== 'hidden' && el.getClientRects().length).length;
    return {title: clip(document.title).slice(0, 180), headings, text: clip(document.body?.innerText).slice(0, 800), inputs};
  };
  // What you answered yourself, kept for next time. Only fields YOU changed count: a person's typing and picking are trusted
  // events, the extension's own writes are not. Read at the Submit press (before the page moves on) and sent to the app,
  // which saves them (desktop/lib/learned.js). Never a password, card, code or a long free text.
  const typed = new Set();
  for (const kind of ['input', 'change']) {
    document.addEventListener(kind, event => { if (event.isTrusted && event.target?.matches?.('input, textarea, select')) typed.add(event.target); }, true);
  }
  const SECRET = /password|passwort|mot de passe|card\s*number|cvv|cvc|iban|\bssn\b|social security|captcha|one-?time|verification code|security code/i;
  const learned = () => {
    const out = new Map();
    for (const el of typed) {
      const type = String(el.type || '').toLowerCase();
      if (!el.isConnected || el.disabled || ['password', 'file', 'checkbox', 'hidden', 'submit', 'button'].includes(type)) continue;
      let value, kind = 'text';
      if (type === 'radio') {
        if (!el.checked) continue;
        value = clean(el.labels?.[0]?.textContent || el.value);
        kind = 'option';
      } else if (el.tagName === 'SELECT') {
        const chosen = el.selectedOptions?.[0];
        if (!chosen || !chosen.value) continue;
        value = clean(chosen.textContent);
        kind = 'option';
      } else value = clean(el.value);
      const label = question(el).slice(0, 120);
      if (!label || !value || value.length > 300 || SECRET.test(label)) continue;
      out.set(label.toLowerCase(), {label, value, kind});
    }
    return [...out.values()].slice(0, 40);
  };
  const noteLearned = () => { const items = learned(); if (items.length) send({type: 'learned', url: location.href, items}).catch(() => {}); };
  const noteSubmit = () => { noteLearned(); send({type: 'submitted', url: location.href, snapshot: snapshot()}).catch(() => {}); };
  document.addEventListener('submit', () => noteSubmit(), true);
  document.addEventListener('click', event => {
    const button = event.target?.closest?.('button, input[type=submit], [role=button]');
    if (!button) return;
    const words = `${button.textContent || ''} ${button.getAttribute?.('aria-label') || ''} ${button.name || ''} ${button.value || ''}`;
    if (button.type === 'submit' || submitWords.test(words)) noteSubmit();
  }, true);
  if (document.documentElement) new MutationObserver(soon).observe(document.documentElement, {childList: true, subtree: true});
  const tick = setInterval(sync, 2000);
  sync();
  }
})();
