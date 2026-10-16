// The panel's own styles and markup (drawn inside its shadow root, so the page's styles cannot touch it). Owns only this string; review.js puts it in the root
// and finds its parts by class. Injected before review.js (panel-files.js). Guarded by desktop/test/panel-click-through, extension-panel-version, cost-labels.
(() => {
  window.__jobPilottoPanelMarkup = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    .jp { --navy: #132439; --ink: #182537; --muted: #5b6b80; --line: #e2e8f0; --soft: #f5f7fb; --signal: #d9540b; --signal-2: #f07014;
      --good: #1f9d55; --good-soft: #e7f6ee; --warn: #9a6200; --warn-soft: #fdf4e4; --info: #165bba; --info-soft: #eaf1fb;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: var(--ink);
      display: flex; flex-direction: column; align-items: flex-end; gap: 10px; pointer-events: none; } .jp > * { pointer-events: auto; }   /* the box is as wide as the pill: its empty part lets the page's clicks through (owner, 9 Oct 2026) */
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
    .head .x { background: transparent; color: #b9c8dc; font-size: 18px; line-height: 1; padding: 2px 4px; border-radius: 6px; }
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
    .tip { display: flex; gap: 8px; align-items: baseline; padding: 8px 14px; border-top: 1px solid var(--line); font-size: 12px; line-height: 1.4; color: var(--ink); cursor: pointer; }
    .tip-chip { flex: none; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
    /* The footer of every state (owner mockup, 16 Oct 2026): the connection on the left, the one Report entry on the right. */
    .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11.5px; }
    .foot .state { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
    .foot .state::before { content: ''; flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
    .foot.on .state::before { background: var(--good); }
    .foot.off .state::before { background: #d92d20; }
    .foot .reload { font: inherit; color: var(--ink); background: none; border: 1px solid var(--line); border-radius: 6px; padding: 2px 8px; cursor: pointer; }
    .foot .report-btn { flex: none; display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 8px; background: #fff; color: var(--ink); border: 1px solid var(--line); font-weight: 600; font-size: 12px; }
    .foot .report-btn:hover { background: var(--soft); }
    .foot .report-btn svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .knock { margin: 0 0 8px; padding: 7px 9px; border-radius: 7px; background: #fff3e0; color: #7a4a00; font-size: 12px; line-height: 1.4; }
    .tailor { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; margin: 10px 0 0; padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--soft); font-size: 12.5px; color: var(--ink); }
    .tailor .secondary { padding: 5px 9px; }
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
        <div class="actions"><button class="secondary report-open" type="button" title="Send this form to be fixed: you read exactly what would be sent first" hidden>Report this form…</button></div>
        <div class="note trace-note" hidden><span>Chrome shows a debugging bar while Job Pilotto keeps a trace of this fill, so you can report a problem.</span><button class="got-it" type="button">Got it</button></div>
>>>>>>> 7d36df5 (Report this form sends a trace kept during the fill, with no reload)
        <div class="note" hidden><span></span><button class="anyway" hidden>Fill anyway</button></div>
        <div class="tailor" hidden><span class="t-text"></span><button class="secondary t-btn">Tailor my CV for this job</button></div>
        <div class="left" hidden><h4>Left for you</h4><p class="knock" hidden></p><div class="list"></div></div>
        <div class="actions">
          <div class="claude-offer" hidden></div>
          <button class="secondary go-there" hidden>Go there</button>
          <button class="secondary open-app" hidden>Open in Job Pilotto</button>
        </div>
      </div>
      <div class="tip" hidden><b class="tip-chip"></b><span class="tip-text"></span></div>
      <div class="foot"><span class="state">Checking the connection…</span><button class="report-btn" type="button" title="Send this form to be fixed: you read exactly what would be sent first" aria-label="Report this form"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 14V2.5M3.5 3h8l-1.6 2.7L11.5 8.5h-8"/></svg>Report</button></div>
    </div>
    <button class="pill" title="Job Pilotto"><span class="ring"><span></span></span><div><b></b><small></small></div></button>
  </div>`;
})();
