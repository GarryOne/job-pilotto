// The Stop button on an application's own page (owner, 13 Oct 2026: "a stop button for everything"): a small chip in its own closed shadow root, drawn on every tab the app opened (injected
// with the panel, background.js arm()). One press sends `stop` to the worker (stop.js): every tab, every press, the debugger, at once. It goes away when the worker says it is stopped.
(() => {
  if (window.top !== window || window.__jobPilottoStopChip) return;
  window.__jobPilottoStopChip = true;
  const host = document.createElement('div');
  host.id = 'jobpilotto-stop-host';
  const root = host.attachShadow({mode: 'closed'});
  root.innerHTML = `<style>
    button { all: initial; position: fixed; left: 12px; bottom: 12px; z-index: 2147483647; box-sizing: border-box; padding: 7px 12px; border-radius: 999px; cursor: pointer;
      font: 600 12px/1 system-ui, sans-serif; color: #fff; background: #b42318; box-shadow: 0 4px 16px #0006; }
    button:hover { background: #912018; } button:focus-visible { outline: 3px solid #fff; outline-offset: 2px; } button[disabled] { opacity: .7; cursor: default; }
  </style><button type="button" title="Stops everything Job Pilotto does, on every tab, until you press Apply in the app again">■ Stop</button>`;
  const button = root.querySelector('button');
  button.addEventListener('click', event => {
    if (!event.isTrusted) return;   // a page's script cannot press it for the person (or against them)
    button.disabled = true;
    button.textContent = 'Stopping…';
    chrome.runtime.sendMessage({type: 'stop', reason: 'the Stop button on the page'}).catch(() => {});
  });
  chrome.runtime.onMessage.addListener(message => { if (message?.type === 'stopped') host.remove(); });
  document.documentElement.append(host);
})();
