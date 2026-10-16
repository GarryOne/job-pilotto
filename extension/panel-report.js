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
    .card { position: fixed; left: 12px; bottom: 52px; z-index: 2147483647; width: 320px; padding: 14px; border-radius: 12px; color: #1d2939; background: #fff; border: 1px solid #d0d5dd; box-shadow: 0 8px 28px #0005; }
    .card b { display: block; margin-bottom: 6px; font-weight: 700; } .card p { margin: 0 0 8px; } .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
    button.act { all: initial; cursor: pointer; padding: 7px 12px; border-radius: 8px; font: 600 12px/1 system-ui, sans-serif; border: 1px solid #d0d5dd; background: #fff; color: #1d2939; }
    button.act.main { background: #175cd3; border-color: #175cd3; color: #fff; } button[disabled] { opacity: .6; cursor: default; }
  </style><button type="button" class="flag" title="Report this form" aria-label="Report this form" hidden>⚑</button><div class="card" role="dialog" aria-label="Report this form" hidden></div>`;
  const flag = root.querySelector('.flag'), card = root.querySelector('.card');
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
    card.hidden = false;
  };
  const ask = message => chrome.runtime.sendMessage(message).catch(() => null);
  const close = () => { card.hidden = true; };
  const WORDS = {login: 'This page asks you to sign in, so it cannot be reported.', stopped: 'Job Pilotto was stopped, so nothing was recorded.', busy: 'Another report is being recorded.',
    debugger: 'Chrome would not let Job Pilotto record this tab.', time: 'The recording hit its time limit.', cancelled: 'Cancelled: nothing was kept.'};

  function recording() {
    say('Recording this page', 'Repeat the step that gets stuck. Chrome shows a bar saying it is debugging this browser while this runs. Nothing leaves your Mac yet.', [
      ['Cancel', false, async () => { await ask({type: 'report-cancel'}); close(); }],
      ['Stop and review', true, async button => {
        button.disabled = true; button.textContent = 'Preparing…';
        const answer = await ask({type: 'report-stop'});
        if (answer?.ok) say('Review it in Job Pilotto', 'The Job Pilotto app shows exactly what would be sent. Nothing is sent until you press Send there.', [['OK', true, close]]);
        else say('Nothing was sent', WORDS[answer?.refused] || (answer?.blocked ? 'Job Pilotto could not remove everything personal from it safely, so nothing was kept.' : 'Job Pilotto could not prepare this report.'), [['OK', true, close]]);
      }]]);
  }
  function confirm() {
    say('Report this form', 'This tab goes back to the job posting and the application starts again from there; answers on this page may be cleared. Job Pilotto records what the site sends across every page and redirect until you press Stop, so the problem can be fixed. Chrome shows its '
      + '"debugging this browser" bar meanwhile. Nothing leaves your Mac until you read it and press Send.', [
      ['Cancel', true, close],
      ['Start recording', false, async button => {
        button.disabled = true;
        const answer = await ask({type: 'report-start'});
        if (answer?.ok) recording(); else say('Could not start', WORDS[answer?.refused] || 'Job Pilotto could not start recording this page.', [['OK', true, close]]);
      }]]);
  }
  flag.addEventListener('click', event => { if (event.isTrusted) { if (card.hidden) confirm(); else close(); } });
  chrome.runtime.onMessage.addListener(message => { if (message?.type === 'stopped') host.remove(); });

  // Drawn only when the switch is on; a page that reloaded while recording (the reload is the start) goes straight back to the recording card.
  // The panel's full-width "Report this form" (panel-claude.js, where Claude's offer used to be) opens the same card; only while the switch is on.
  window.__jobPilottoReportOpen = () => { if (card.hidden) confirm(); };   // the panel's ⚑ (review.js), always shown
  window.addEventListener('jobpilotto-report-open', () => window.__jobPilottoReportOpen());   // the panel's ⚑ (always shown) and the stuck page's button: the card asks before anything is recorded
  ask({type: 'report-state'}).then(state => { if (!state?.enabled) return; flag.hidden = false; window.__jobPilottoReportOn = true; window.dispatchEvent(new CustomEvent('jobpilotto-report-ready')); if (state.recording) recording(); });
  document.documentElement.append(host);
})();
