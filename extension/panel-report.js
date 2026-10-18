// The "Report this form" flag on an application's own page (spec docs/superpowers/specs/2026-10-15-report-this-form.md §3): a small icon in its own closed shadow root beside the Stop chip, drawn on
// every tab the app opened (injected with the panel, background.js arm()), and only while the Settings switch is on. Nothing is recorded or reloaded by drawing it: a press opens one card that says
// what will happen (the page reloads, answers may be cleared, Chrome shows its debugging bar), and only "Start recording" starts it. "Stop and review" hands the record to the app, whose window shows
// what would be sent. Its worker side is messages-report.js. Guard: desktop/test/report-panel.test.js.
(() => {
  if (window.top !== window || window.__jobPilottoReportChip) return;
  window.__jobPilottoReportChip = true;
  const host = document.createElement('div');
  host.id = 'jobpilotto-report-host';
  const root = host.attachShadow({mode: 'closed'});
  root.innerHTML = `<style>
    * { box-sizing: border-box; font: 500 13px/1.4 system-ui, sans-serif; }
    .flag { all: initial; position: fixed; left: 92px; bottom: 12px; z-index: 2147483647; width: 30px; height: 30px; border-radius: 999px; cursor: pointer; display: grid; place-items: center;
      color: #1d2939; background: #fff; border: 1px solid #d0d5dd; box-shadow: 0 4px 16px #0004; font: 600 15px/1 system-ui, sans-serif; }
    .flag:hover { background: #f2f4f7; } .flag:focus-visible, button:focus-visible { outline: 3px solid #175cd3; outline-offset: 2px; }
    .card.beside { left: auto; right: 18px; bottom: 84px; }   /* opened from the panel's Report: beside the panel's pill, where the press was, not in the far corner */
    .card { position: fixed; left: 12px; bottom: 52px; z-index: 2147483647; width: 320px; padding: 14px; border-radius: 12px; color: #1d2939; background: #fff; border: 1px solid #d0d5dd; box-shadow: 0 8px 28px #0005; }
    .card b { display: block; margin-bottom: 6px; font-weight: 700; } .card p { margin: 0 0 8px; } .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
    button.act { all: initial; cursor: pointer; padding: 7px 12px; border-radius: 8px; font: 600 12px/1 system-ui, sans-serif; border: 1px solid #d0d5dd; background: #fff; color: #1d2939; }
    button.act.main { background: #175cd3; border-color: #175cd3; color: #fff; } button[disabled] { opacity: .6; cursor: default; }
  </style><button type="button" class="flag" title="Report this form" aria-label="Report this form" hidden>⚑</button><div class="card" role="dialog" aria-label="Report this form" hidden></div>`;
  const flag = root.querySelector('.flag'), card = root.querySelector('.card');
  let beside = false;   // the card opens next to the panel when the panel's Report asked for it, else beside the Stop chip
  const say = (title, text, buttons = []) => {
    card.replaceChildren();
    const head = document.createElement('b'), body = document.createElement('p'), row = document.createElement('div');
    head.textContent = title; body.textContent = text; row.className = 'row';
    for (const [label, main, onPress] of buttons) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = `act${main ? ' main' : ''}`; button.textContent = label;
      button.addEventListener('click', event => { if (event.isTrusted) onPress(button); });   // a page's script cannot press it for the person
      row.append(button);
    }
    card.append(head, body, row);
    card.classList.toggle('beside', beside);
    card.hidden = false;
  };
  const ask = message => chrome.runtime.sendMessage(message).catch(() => null);
  const close = () => { card.hidden = true; };
  const WORDS = {stopped: 'Job Pilotto was stopped, so nothing was kept. Press Apply in the app to start again.', worker: 'Job Pilotto could not reach its extension service. Reload this page and try again.',
    off: 'The trace is turned off in Job Pilotto Settings, so there is nothing to report.', empty: 'Nothing has been kept on this page yet (a sign-in page is never kept). Try again after the page has loaded.'};

  // The one sentence when the app's last check refuses (the same words as the app's Send, desktop/lib/report-handlers.js), then the kinds it found: never a value.
  const BLOCKED = 'Job Pilotto could not remove everything personal from it safely, so nothing was sent.';
  const KINDS = {email: 'an e-mail address', phone: 'a phone number', name: 'your name', 'name-in-code': 'your name inside a script', location: 'your place', token: 'a sign-in token'};

  // The press hands over the trace Job Pilotto already keeps for this tab: no reload, no new recording. A tab that moved past its first page asks once: the whole journey or this page.
  async function send(scope, button) {
    button.disabled = true; button.textContent = 'Preparing…';
    const answer = await ask({type: 'report-send', scope});
    if (answer?.ok) say('Review it in Job Pilotto', 'The Job Pilotto app shows exactly what would be sent. Nothing is sent until you press Send there.', [['OK', true, close]]);
    else say('Nothing was sent', WORDS[answer?.refused] || (answer?.blocked ? `${BLOCKED} Still found: ${[...new Set((answer?.blocked || []).map(kind => KINDS[kind] || kind))].join(', ')}.` : 'Job Pilotto could not prepare this report.'), [['OK', true, close]]);
  }
  async function confirm() {
    say('Report this form', 'Checking what Job Pilotto kept…', []);
    if (beside) window.dispatchEvent(new CustomEvent('jobpilotto-report-shown'));   // the panel folds itself so the card is the one thing at that corner (review.js)
    const state = await ask({type: 'report-state'});
    const lead = 'Job Pilotto keeps a trace of this form fill on your Mac, without sign-in pages. The app shows exactly what would be sent. Nothing leaves your Mac until you read it and press Send.';
    if (!state) { say('Report could not start', WORDS.worker, [['OK', true, close]]); return; }
    if (!state.has) { say('Nothing to report yet', WORDS[state.stopped ? 'stopped' : state.enabled === false ? 'off' : 'empty'], [['OK', true, close]]); return; }
    const buttons = [['Cancel', false, close]];
    if (state.moved) buttons.push(['Only this page', false, button => send('page', button)], ['The whole journey (recommended for fixing)', true, button => send('journey', button)]);
    else buttons.push(['Review in Job Pilotto', true, button => send('journey', button)]);
    say('Report this form', lead, buttons);
  }
  flag.addEventListener('click', event => { if (event.isTrusted) { beside = false; if (card.hidden) confirm(); else close(); } });
  // The panel's Report always (re)opens the card, even when it is already shown (a press is never a silent no-op). From a frame that is not the top one it arrives as a message (messages-report.js relays it).
  const openFromPanel = () => { beside = true; confirm(); };
  // Stop takes the ⚑ away but keeps the card: the panel's Report still answers after a Stop (it says it was stopped), never draws into a detached node.
  chrome.runtime.onMessage.addListener(message => { if (message?.type === 'stopped') flag.hidden = true; if (message?.type === 'report-open') openFromPanel(); });

  // Drawn only when the switch is on.
  // The panel's full-width "Report this form" (panel-claude.js, where Claude's offer used to be) opens the same card; only while the switch is on.
  window.__jobPilottoReportOpen = openFromPanel;   // the panel's ⚑ (review.js), always shown
  window.addEventListener('jobpilotto-report-open', openFromPanel);   // the panel's ⚑ (always shown) and the stuck page's button: the card asks before anything is recorded
  ask({type: 'report-state'}).then(state => { if (!state?.enabled) return; flag.hidden = false; window.__jobPilottoReportOn = true; window.dispatchEvent(new CustomEvent('jobpilotto-report-ready')); if (state.tracing) window.dispatchEvent(new CustomEvent('jobpilotto-trace-on')); });
  document.documentElement.append(host);
})();
