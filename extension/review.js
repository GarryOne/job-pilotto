// The Job Pilotto panel, on every application form (bottom right). Collapsed: a pill with a progress ring and what's
// left ("3 left", green "Ready to submit"). Open: the job, what Claude is doing on it, the progress, one Fill button,
// what's left for you (click one: the page scrolls to it), and I submitted it / Copy cover letter / Open in Job Pilotto.
// App first: the job, its Apply with Claude session and the form's state are shared with the Job Pilotto app both
// ways (the agreements you tick here are ticked off there; "Show it in the form" there scrolls here). Without the
// app it still shows the form's progress, and fills through the extension's own connection.
// The panel itself never types, ticks or clicks anything in the form: filling goes through the extension's fill.
(() => {
  // Once per page, but a copy left behind by an extension reload (its chrome.runtime is gone) gives way to the new one.
  if (window.__jobPilottoReviewAlive?.()) return;
  window.__jobPilottoReviewAlive = () => !!chrome.runtime?.id;
  document.getElementById('jobpilotto-review-host')?.remove();

  const MIN_FIELDS = 3;
  const SKIP = ['hidden', 'submit', 'button', 'reset', 'search', 'image'];
  const AGREE = /agree|consent|acknowledg|terms|privacy|policy|arbitrat|certif|attest|pledge/i;
  const clean = text => String(text || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim();
  const norm = text => clean(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const send = message => (chrome.runtime?.id ? chrome.runtime.sendMessage(message) : Promise.reject(new Error('reloaded')));

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
  const comboFilled = el => !!el.closest('[class*=container]')?.querySelector('[class*=single-value], [class*=multi-value]');
  function fields() {
    const groups = new Map();
    for (const el of document.querySelectorAll('input, textarea, select')) {
      if (SKIP.includes(el.type) || el.disabled || el.getAttribute('aria-hidden') === 'true' || !visible(el)) continue;
      const grouped = ['checkbox', 'radio'].includes(el.type) && el.closest('fieldset');
      const key = grouped ? `group:${question(el)}` : el.type === 'radio' ? `radio:${el.name}` : el;
      const filled = el.type === 'file' ? !!el.files?.length : el.getAttribute('role') === 'combobox' ? comboFilled(el)
        : ['checkbox', 'radio'].includes(el.type) ? el.checked : !!String(el.value || '').trim();
      const entry = groups.get(key) || {el, label: question(el), required: false, filled: false};
      entry.required ||= required(el);
      entry.filled ||= filled;
      groups.set(key, entry);
    }
    for (const entry of groups.values()) {  // a CV some sites show only as a file name once attached
      if (!entry.filled && entry.el.type === 'file') {
        let box = entry.el;
        for (let i = 0; i < 4 && box.parentElement; i++) box = box.parentElement;
        entry.filled = /\S+\.(pdf|docx?|rtf|txt|odt)\b/i.test(box.textContent || '');
      }
    }
    return [...groups.values()];
  }
  function find(label, list = fields()) {
    const wanted = norm(label);
    if (!wanted) return null;
    return list.find(f => norm(f.label) === wanted) || list.find(f => norm(f.label).includes(wanted) || (norm(f.label).length > 8 && wanted.includes(norm(f.label))));
  }
  function flash(el) {
    el.scrollIntoView({behavior: 'smooth', block: 'center'});
    const target = el.closest('fieldset') || el;
    const [outline, offset] = [target.style.outline, target.style.outlineOffset];
    target.style.outline = '3px solid #f07014';
    target.style.outlineOffset = '4px';
    setTimeout(() => { target.style.outline = outline; target.style.outlineOffset = offset; }, 3500);
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
    .primary { width: 100%; padding: 10px; border-radius: 10px; background: var(--signal); color: #fff; font-weight: 650; }
    .primary:hover { background: #c44a08; }
    .primary:disabled { opacity: .6; cursor: default; }
    .step { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 12px; }
    .step::before { content: ''; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--signal); animation: spin .8s linear infinite; flex: none; }
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
        <div class="fill-box"><button class="primary fill">Fill this form</button><div class="step" hidden></div></div>
        <div class="note" hidden><span></span><button class="anyway" hidden>Fill anyway</button></div>
        <div class="left" hidden><h4>Left for you</h4><div class="list"></div></div>
        <div class="actions">
          <button class="secondary applied">I submitted it</button>
          <button class="secondary letter" hidden>Copy cover letter</button>
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
    const needed = list.filter(f => f.required);
    shown = needed.filter(f => !f.filled);
    const total = needed.length, left = shown.length, ready = total > 0 && left === 0;
    const done = total ? Math.round(100 * (total - left) / total) : 0;
    jp.classList.toggle('ready', ready);
    $('.ring').style.setProperty('--done', done);
    $('.ring span').textContent = ready ? '✓' : total ? String(left) : '–';
    $('.pill b').textContent = ready ? 'Ready to submit' : total ? `${left} left` : 'Job Pilotto';
    $('.pill small').textContent = (job?.company || session?.company) ? (job?.company || session?.company) : ready ? 'Review, then submit' : 'required fields';
    if (!open) return {list, left, total};
    // job + Claude
    const title = job?.title || session?.title, company = job?.company || session?.company;
    $('.job').hidden = !title;
    $('.job-title').textContent = title || '';
    $('.job-meta').replaceChildren(...[company && Object.assign(document.createElement('span'), {textContent: company}),
      job?.stage && Object.assign(document.createElement('span'), {className: `tag ${/applied/i.test(job.stage) ? 'good' : ''}`, textContent: job.stage})].filter(Boolean));
    const claude = session?.live && session.status === 'running' ? `Claude is filling this form · ${session.note || 'working'}`
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
    // what's left
    $('.left').hidden = !left;
    $('.list').replaceChildren(...shown.slice(0, 30).map(field => {
      const row = Object.assign(document.createElement('button'), {className: 'item'});
      row.append(Object.assign(document.createElement('i'), {textContent: AGREE.test(field.label) ? '⚖️' : '○'}),
        Object.assign(document.createElement('span'), {textContent: field.label.slice(0, 120) || 'A required field'}),
        Object.assign(document.createElement('span'), {className: 'go', textContent: '›'}));
      row.onclick = () => flash(field.el);
      return row;
    }));
    // actions + connection
    $('.letter').hidden = !job?.coverLetter;
    $('.open-app').hidden = !session;
    const foot = $('.foot');
    foot.classList.toggle('on', !!connection?.connected);
    foot.textContent = connection?.connected ? (connection.app ? (session ? 'In sync with Job Pilotto' : 'Connected to Job Pilotto') : 'Connected to your Worker')
      : connection ? (connection.why || 'Not connected: the form still fills from your settings') : 'Checking the connection…';
    return {list, left, total};
  }

  // ---- actions ----
  async function fill(force = false) {
    filling = true;
    $('.note').hidden = true;
    $('.step').hidden = false;
    $('.step').textContent = 'Reading the form…';
    render();
    const result = await send({type: 'panelFill', url: session?.url || job?.url || location.href, force}).catch(error => ({ok: false, error: error.message}));
    filling = false;
    $('.step').hidden = true;
    $('.fill').textContent = 'Fill again';
    if (result?.ineligible) note(`Not filled: ${result.note}`, true);
    else if (!result?.ok) note(`Couldn't fill: ${result?.error || 'try again'}`);
    if (result?.coverLetter && job) job.coverLetter ||= result.coverLetter;
    render();
  }
  function note(text, anyway = false) {
    $('.note').hidden = false;
    $('.note span').textContent = text;
    $('.anyway').hidden = !anyway;
  }
  $('.fill').onclick = () => fill();
  $('.anyway').onclick = () => fill(true);
  $('.applied').onclick = async () => {
    $('.applied').disabled = true;
    const result = await send({type: 'panelApplied', url: session?.url || job?.url || location.href}).catch(error => ({ok: false, error: error.message}));
    $('.applied').textContent = result?.ok ? '✓ Marked Applied' : 'I submitted it';
    $('.applied').disabled = !!result?.ok;
    if (!result?.ok) note(`Not marked: ${result?.error || 'try again'}`);
  };
  $('.letter').onclick = async () => {
    try { await navigator.clipboard.writeText(job.coverLetter); $('.letter').textContent = 'Copied ✓'; } catch { $('.letter').textContent = 'Copy failed'; }
    setTimeout(() => { $('.letter').textContent = 'Copy cover letter'; }, 2000);
  };
  $('.open-app').onclick = () => session && send({type: 'panelOpenApp', session: session.id}).catch(() => {});
  // The extension's fill reports its steps here (instead of a floating box).
  chrome.runtime.onMessage.addListener((message, _, reply) => {
    if (message?.type !== 'panelStep') return false;
    if (!host.isConnected) { reply({shown: false}); return false; }
    if (message.text) { $('.step').hidden = false; $('.step').textContent = message.text; if (!open) setOpen(true); }
    reply({shown: true});
    return false;
  });

  // ---- in step with the app ----
  let watch = [], timer = null, busy = false, jobAsked = '';
  async function sync() {
    if (!chrome.runtime?.id) { host.remove(); clearInterval(tick); return; }  // this copy was replaced by a reload
    const state = render();
    if (!state || busy) return;
    busy = true;
    try {
      const payload = {url: location.href, title: document.title, left: state.left, total: state.total,
        watch: watch.map(({id, label}) => { const field = find(label, state.list); return {id, filled: field ? field.filled : null}; })};
      const reply = await send({type: 'review', payload});
      session = reply?.session || null;
      const before = JSON.stringify(watch);
      watch = Array.isArray(reply?.watch) ? reply.watch : [];
      // The app asked to see this form (and maybe one field): this tab comes forward, then the field.
      for (const command of reply?.commands || []) {
        send({type: 'panelShowTab'}).catch(() => {});
        if (!open) setOpen(true);
        const field = command.focus && find(command.focus, state.list);
        if (field) flash(field.el);
      }
      // The job once per page (and again when a session matched): title, stage, kit, cover letter.
      const wanted = session?.url || location.href;
      if (jobAsked !== wanted) {
        jobAsked = wanted;
        connection = await send({type: 'panelJob', url: wanted}).catch(() => ({connected: false}));
        job = connection?.job ? {...connection.job, coverLetter: connection.coverLetter} : null;
        // Open by itself the first time on a job it knows (you can close it; it stays closed).
        if ((job || session) && !userMoved && !open) setOpen(true);
      }
      render();
      if (JSON.stringify(watch) !== before) setTimeout(sync, 50);
    } catch { /* the app is closed: the panel still shows the form's progress */ } finally { busy = false; }
  }
  const soon = () => { clearTimeout(timer); timer = setTimeout(sync, 400); };
  document.addEventListener('input', soon, true);
  document.addEventListener('change', soon, true);
  new MutationObserver(soon).observe(document.documentElement, {childList: true, subtree: true});
  const tick = setInterval(sync, 2000);
  sync();
})();
