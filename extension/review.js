// The Job Pilotto panel, only on a tab the desktop app opened (bottom right). Collapsed: a pill with a progress ring and what's
// left ("3 left", green "Ready to submit"). Open: the job, what Claude is doing on it, the progress, one Fill button,
// what's left for you (click one: the page scrolls to it), and Open in Job Pilotto.
// App first: the job, its Apply with Claude session and the form's state are shared with the Job Pilotto app both
// ways (the agreements you tick here are ticked off there; "Show it in the form" there scrolls here). Without the
// app it still shows the form's progress, and fills through the extension's own connection.
// The panel itself never types, ticks or clicks anything in the form: filling goes through the extension's fill.
// This file owns the panel's state, drawing, fill button and the sync with the app. Its parts are injected before it (panel-files.js): panel-form.js reads the form,
// panel-markup.js is the styles and markup, panel-learn.js reports what the person did. They share window.__jobPilottoPanel* (a content script has no imports).
(() => {
  // Once per page, but a copy left behind by an extension reload (its chrome.runtime is gone) gives way to the new one.
  if (window.__jobPilottoReviewAlive?.() || ['Required', 'ReadBack', 'TitleAbove', 'GroupTitle', 'PanelForm', 'PanelMarkup', 'PanelLearn', 'PanelWritten'].some(name => !window['__jobPilotto' + name] && (console.warn('Job Pilotto panel: helper script missing:', name), true))) return;   // only some helper scripts ran (a reload with the tab open): draw nothing, say which, the next full injection mounts; the option grouping alone is soft
  window.__jobPilottoReviewAlive = () => !!chrome.runtime?.id;
  let askedPassword = 0;
  const send = message => (chrome.runtime?.id ? chrome.runtime.sendMessage(message) : Promise.reject(new Error('reloaded')));
  // The desktop app is the only way onto a page. Anywhere else this script was injected (an old "every site"
  // registration, a reload) it draws nothing and listens for nothing.
  send({type: 'panelAllowed'}).then(answer => { if (answer?.ok) mount(); }).catch(() => {});

  function mount() {
  document.getElementById('jobpilotto-review-host')?.remove();

  const MIN_FIELDS = 3;
  const MARK_WORDS = {reading: 'Reading this page…', other: 'This page shows no application', 'signing-in': 'Logging in…', 'signing-up': 'Creating your account…'};   // page-mark.js; a posting: the owner's own words
  const {KNOCKOUT, AGREE, fields, find, flash} = window.__jobPilottoPanelForm;

  // ---- the panel (its own shadow root: the page's styles can't touch it, it can't touch the page) ----
  const host = Object.assign(document.createElement('div'), {id: 'jobpilotto-review-host'});
  host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483646;pointer-events:none;';   // only the card and the pill take clicks (.jp > *)
  const root = host.attachShadow({mode: 'open'});
  root.innerHTML = window.__jobPilottoPanelMarkup;
  const $ = selector => root.querySelector(selector);
  const jp = $('.jp'), card = $('.card'), pill = $('.pill');
  const written = window.__jobPilottoPanelWritten.start({send, alive: () => host.isConnected});   // Review my answer beside each written question's box (panel-written.js)
  window.__jobPilottoClaude?.mount(root, send);   // the stuck page's Claude offer: its own script (panel-claude.js)
  const SHOW_TIPS = false;   // the tip line (Fact / Recruiters say / Tip / Worth trying) is off for now (owner, 15 Oct 2026: "hide, disable it, we'll get back to it"); true brings it back
  let moved = false, movedTab = null, open = false, shown = [], job = null, session = null, connection = null, claudeAsk = {}, filling = false, userMoved = false, cv = null, asked = false, tipFor = null;

  const setOpen = value => { open = value; card.hidden = !open; if (open) render(); };
  pill.onclick = () => { userMoved = true; setOpen(!open); };
  $('.x').onclick = () => { userMoved = true; setOpen(false); };
  // "Report this form", always there on every state (owner, 16 Oct 2026: "a small icon that will trigger Report this form"): the same card as the corner ⚑ (panel-report.js).
  $('.report-flag').onclick = event => { if (event.isTrusted) window.__jobPilottoReportOpen?.(); };
  // The labelled button for the same card (owner, 16 Oct 2026: the icon alone was not found); shown once the app says the switch is on (panel-report.js).
  $('.report-open').onclick = event => { if (event.isTrusted) window.__jobPilottoReportOpen?.(); };
  const showReport = () => { $('.report-open').hidden = !window.__jobPilottoReportOn; };
  window.addEventListener('jobpilotto-report-ready', showReport);

  // ---- drawing ----
  function render(list = fields()) {
    const account = !!document.querySelector('input[type=password]');
    // An empty password box is filled from the Keychain (asked again now and then; the value never comes to this panel). Asked BEFORE the
    // field count below: a sign-in page has two boxes (Coop's SuccessFactors, live run 8 Oct 2026), too few for a panel.
    if (account && Date.now() - askedPassword > 2000 && [...document.querySelectorAll('input[type=password]')].some(box => (!box.value || (box.hasAttribute('data-jobpilotto-filled') && !document.documentElement.hasAttribute('data-jobpilotto-account-pressed'))) && box.getClientRects().length)) {
      askedPassword = Date.now();
      send({type: 'sitePassword'}).catch(() => {});
    }
    if (list.length < MIN_FIELDS && !document.documentElement.hasAttribute('data-jobpilotto-needs')) { host.remove(); return null; }   // a sign-in page is too small for a panel, unless the AI says it needs the person
    if (!host.isConnected) document.documentElement.append(host);
    // An answer Claude wrote that is now empty (marked amber) still needs you, required or not.
    written.update(list);
    const needed = list.filter(f => f.required || f.ai || f.changed || f.draft);
    shown = needed.filter(f => !f.filled);
    const total = needed.length, left = shown.length, pageMark = (m => (['form', 'account', 'sign-up'].includes(m) ? '' : m || 'reading'))(document.documentElement.getAttribute('data-jobpilotto-page') || ''), ready = !moved && !pageMark && total > 0 && left === 0, needsYou = document.documentElement.getAttribute('data-jobpilotto-needs');
    const done = total ? Math.round(100 * (total - left) / total) : 0;
    jp.classList.toggle('ready', ready && !needsYou);
    $('.ring').style.setProperty('--done', done);
    $('.ring span').textContent = moved ? '↗' : pageMark ? '…' : ready && !needsYou ? '✓' : total ? String(left) : '–';
    const readyWords = needsYou ? `Needs you: ${needsYou.replace(/^1$/, 'see what the page asks')}` : account ? (document.documentElement.getAttribute('data-jobpilotto-account-step') === 'sign_up' ? 'Ready to create the account' : document.documentElement.getAttribute('data-jobpilotto-account-step') === 'sign_in' ? 'Ready to sign in' : 'Ready to continue') : 'Ready to submit';   // the AI's veto (account-step.js, form-ready.js): a consent link or a widget the count cannot see
    // A tab the application has moved on from (the app bound another tab of it) never says Ready or counts: only the tab with the form does.
    $('.pill b').textContent = moved ? 'Continues in another tab' : pageMark ? (MARK_WORDS[pageMark] || 'Apply button detected. Redirecting…') : ready || needsYou ? readyWords : total ? `${left} left` : 'Job Pilotto';
    $('.pill small').textContent = (job?.company || session?.company) ? (job?.company || session?.company) : ready ? (account ? (document.documentElement.getAttribute('data-jobpilotto-account-step') === 'sign_up' ? 'Review, then create it' : document.documentElement.getAttribute('data-jobpilotto-account-step') === 'sign_in' ? 'Review, then sign in' : 'Review, then continue') : 'Review, then submit') : 'required fields';
    // A fill running (this panel's, Claude's, the popup's) or over: a field filled after it is yours.
    const busy = filling || (session?.live && session.status === 'running') || $('.fill').classList.contains('is-busy');
    const over = filledOnce || ['done', 'input'].includes(session?.status);
    if (!open) return {list, left, total, busy, over, account};
    // job + Claude
    const title = job?.title || session?.title, company = job?.company || session?.company;
    $('.job').hidden = !title;
    $('.job-title').textContent = title || '';
    $('.job-meta').replaceChildren(...[company && Object.assign(document.createElement('span'), {textContent: company}),
      job?.stage && Object.assign(document.createElement('span'), {className: `tag ${/applied/i.test(job.stage) ? 'good' : ''}`, textContent: job.stage})].filter(Boolean));
    $('.go-there').hidden = !(moved && Number.isInteger(movedTab));
    const claude = pageMark ? '' : moved ? 'This application continues in another tab.'   // an older tab of the session: it no longer reports
      : session?.kind === 'form' ? ''   // the Apply button's session: the extension fills it, there is no Claude to name
      : session?.live && session.status === 'running' ? `Claude is filling this form · ${session.note || 'working'}`
      : session?.live && session.status === 'input' ? 'Claude is waiting for you in Job Pilotto.'
      : session?.status === 'done' ? 'Claude filled this form. Review it, then submit it yourself.' : '';
    $('.claude').hidden = !claude;
    $('.claude span').textContent = claude;
    // progress
    $('.progress-line b').textContent = moved ? 'Continues in another tab' : pageMark ? (MARK_WORDS[pageMark] || 'Apply button detected. Redirecting…') : ready ? readyWords : total ? `${total - left} of ${total}` : 'No required fields';
    $('.progress-line span').textContent = moved || pageMark ? '' : ready ? 'every required field is filled' : total ? 'required fields filled' : '';
    $('.bar i').style.width = `${moved || pageMark ? 0 : ready ? 100 : done}%`;
    // fill (not while Claude is filling this form: it would fight it)
    const claudeFilling = session?.live && session.status === 'running';
    // A tailored CV written after the form was filled still has to be attached: the button stays for that.
    // A sign-in or sign-up page (a password box) is not the application: no CV goes there, so no "Tailor my CV" (owner, 8 Oct 2026).
    const canTailor = !!session && !!connection?.connected && !!connection.app && !!cv && !account && !pageMark;
    const readyNow = canTailor && cv.tailored && asked;
    $('.fill-box').hidden = moved || claudeFilling || (ready && !filling && !readyNow);  // nothing left to fill
    $('.fill').disabled = filling;
    // What's left for you, once the filling is over: before and during it, nearly every field is still to be filled
    // by the extension or Claude, not by you (the ring and the bar show the progress meanwhile).
    $('.left').hidden = moved || !!pageMark || !left || busy || !over;
    const knockout = field => KNOCKOUT.test(field.label) || field.category === 'knockout', ranked = [...shown].sort((a, b) => knockout(b) - knockout(a));   // or the AI, any language
    const knockouts = ranked.filter(knockout).length;
    $('.knock').hidden = !knockouts;
    $('.knock').textContent = 'Some of these can trigger automatic rejection if the employer has set a knockout rule (work permit, sponsorship, location, office days); others are only flagged for review. Answer them truthfully: they can decide more than the CV.';
    $('.list').replaceChildren(...ranked.slice(0, 30).map(field => {
      const row = Object.assign(document.createElement('button'), {className: 'item'});
      row.append(Object.assign(document.createElement('i'), {textContent: knockout(field) ? '⛔' : AGREE.test(field.label) || field.category === 'legal' ? '⚖️' : field.draft ? '✍️' : '○'}),
        Object.assign(document.createElement('span'), {textContent: field.label.slice(0, 120) || 'A required field'}),
        ...(field.draft ? [Object.assign(document.createElement('span'), {className: 'tag warn', textContent: field.draft === 'outline' ? 'Outline: complete it' : 'Drafted for you: review'}),   // typed by us, never counted as done until read (owner, 16 Oct 2026)
          Object.assign(document.createElement('span'), {className: 'tag', textContent: 'Review my answer', onclick: event => { event.stopPropagation(); flash(field.el); written.review(field); }})] : []),
        Object.assign(document.createElement('span'), {className: 'go', textContent: '›'}));
      row.onclick = () => flash(field.el);
      return row;
    }));
    // A CV written for this job gets noticeably more replies than the general one: offered while the form is still open, the person's click (it costs a few cents).
    // Once it is written the fill has to run again to attach it.
    const tailor = $('.tailor');
    tailor.hidden = !canTailor || (cv.tailored && !asked);
    if (!tailor.hidden) {
      $('.t-text').textContent = readyNow ? 'Your tailored CV is ready. Press Fill again to attach it.' : cv.working ? 'Tailoring your CV for this job… about 1–2 minutes.'
        : 'This form has your general CV. A CV tailored to this job gets noticeably more replies.';
      $('.t-btn').hidden = readyNow || cv.working;
    }
    // One tip at the bottom, about what the form is at: knockout questions left, no tailored CV yet, else the CV. Click for the next one.
    const prefer = knockouts ? 'knockout' : canTailor && !cv.tailored ? 'tailor' : 'cv';
    if (SHOW_TIPS && tipFor !== prefer && connection?.connected) { tipFor = prefer; askTip(); }
    // actions + connection
    $('.open-app').hidden = !session;
    showReport();
    window.__jobPilottoClaude?.render({on: !!connection?.connected && !!connection.app && !!claudeAsk.help, stuck: !!session?.stuck && !(session?.live && ['running', 'input'].includes(session.status)), always: !!claudeAsk.always, auto: !!claudeAsk.auto, consent: !!claudeAsk.consent, takeover: claudeAsk.takeover !== false, report: !!window.__jobPilottoReportOn, needs: () => shown[0] && flash(shown[0].el)});   // offered, never automatic unless "always" (panel-claude.js)
    const foot = $('.foot');
    foot.classList.toggle('on', !!connection?.connected);
    const state = connection?.connected ? (connection.app ? (session ? 'In sync with Job Pilotto' : 'Connected to Job Pilotto') : 'Connected to your Worker')
      : connection ? (connection.why || 'Not connected: the form still fills from your settings') : 'Checking the connection…'; const version = chrome.runtime.getManifest().version; foot.textContent = `${state} · v${version}`; foot.title = `Job Pilotto extension v${version}`;   // the build is in every screenshot (owner, 11 Oct 2026)
    return {list, left, total, busy, over, account};
  }

  // ---- actions ----
  // What the fill is doing, shown in the button; a fill's empty end step ends it. The timer is only a safety net: 45 s, not 6 (owner, 15 Oct 2026: "Fill again" showed while Claude's later pass was still answering).
  let stepTimer = null, filledOnce = false, stepped = false; const STEP_SAFETY_MS = 45000;
  function showStep(text, wait = STEP_SAFETY_MS) {
    stepped = true;
    const button = $('.fill');
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
    button.title = text;
    $('.fill .label').textContent = text;
    clearTimeout(stepTimer);
    if (!filling) stepTimer = setTimeout(endStep, wait);
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
    else if (result.sharedNote) note(result.sharedNote);   // the service changed how a control was filled: say so
    render();
  }
  function note(text, anyway = false) {
    $('.note').hidden = false;
    $('.note span').textContent = text;
    $('.anyway').hidden = !anyway;
  }
  $('.fill').onclick = () => fill();
  $('.anyway').onclick = () => fill(true);
  const LABEL = {research: 'Fact', recruiters: 'Recruiters say', advice: 'Tip', 'to-test': 'Worth trying'};
  async function askTip() {
    const answer = await send({type: 'panelTip', host: location.hostname, prefer: tipFor}).catch(() => null);
    if (!answer?.ok) return;
    $('.tip-chip').textContent = LABEL[answer.evidence] || 'Tip';
    $('.tip-text').textContent = answer.text;
    $('.tip').hidden = false;
  }
  $('.tip').onclick = askTip;
  $('.t-btn').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Asking Job Pilotto…';
    const answer = await send({type: 'panelTailor'}).catch(() => null);
    asked = !!answer?.ok;
    button.disabled = false;
    button.textContent = 'Tailor my CV for this job';
    render();
  };
  $('.go-there').onclick = () => Number.isInteger(movedTab) && send({type: 'panelGoTab', tab: movedTab}).catch(() => {});
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

  // A note from the extension's worker (page-notes.js): the panel's own note line, so the page never shows a second box beside it.
  chrome.runtime.onMessage.addListener((message, _, reply) => {
    if (message?.type !== 'panelNote') return false;
    if (!host.isConnected) { reply({shown: false}); return false; }
    note(String(message.text || ''), !!message.anyway); if (!open) setOpen(true);
    reply({shown: true});
    return false;
  });

  // A fill already on a step when this panel appeared: show it here (the background removes its floating copy).
  send({type: 'panelStepNow'}).then(answer => { if (answer?.text && host.isConnected) { showStep(answer.text, answer.wait || STEP_SAFETY_MS); if (!open) setOpen(true); } }).catch(() => {});

  const learn = window.__jobPilottoPanelLearn.start({send, alive: () => host.isConnected, form: window.__jobPilottoPanelForm});

  // ---- in step with the app ----
  let watch = [], timer = null, busy = false, jobAsked = '';
  async function sync() {
    if (!chrome.runtime?.id) { host.remove(); clearInterval(tick); return; }  // this copy was replaced by a reload
    const state = render();
    if (!state || busy) return;
    learn.reportMisses(state.list);
    busy = true;
    try {
      const payload = window.__jobPilottoReviewPayload(state, watch, {agree: AGREE, find});
      const reply = await send({type: 'review', payload});
      moved = !!reply?.moved; movedTab = Number.isInteger(reply?.tab) ? reply.tab : null;
      session = reply?.session || null; claudeAsk = {takeover: reply?.claudeTakeover !== false, help: !!reply?.claudeHelp, always: !!reply?.claudeAlways, auto: !!reply?.claudeAuto, consent: !!reply?.claudeConsent};   // the app's Claude readiness and choices (lib/claude-ready.js)
      cv = reply?.cv || null;
      const before = JSON.stringify(watch);
      watch = Array.isArray(reply?.watch) ? reply.watch : [];
      // The app asked to see this form (and maybe one field): this tab comes forward, then the field.
      for (const command of reply?.commands || []) {
        // The app asked this page to reload itself: the repair for a page whose panel died with an older extension
        // instance (an uninstall/reinstall leaves it unable to answer). This panel is alive, so it can do it.
        if (command.reload) { location.reload(); return; }
        if (command.close) { send({type: 'panelCloseTab'}).catch(() => {}); return; } if (command.fill) { send({type: 'panelFillOne', ...command.fill}).catch(() => {}); continue; }   // cancelled in the app; "Use" there: the worker fills it (fill-flow.js)
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
  if (document.documentElement) new MutationObserver(soon).observe(document.documentElement, {childList: true, subtree: true});
  const tick = setInterval(sync, 2000);
  sync();
  }
})();