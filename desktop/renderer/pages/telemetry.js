// Technical reports: the window's own errors go to the app's reporter (lib/telemetry.js, scrubbed there); Settings →
// Advanced shows the switch and the last events, exactly as they'd be sent.
import {$} from './core.js';

let reported = 0;  // at most a few per session: a broken loop must not flood the queue
function report(fields) {
  if (reported++ >= 20) return;
  window.pilot.telemetryRecord('crash', {where: 'window', page: document.querySelector('.view:not([hidden])')?.dataset.view || '', ...fields}).catch(() => {});
}

async function show() {
  const {on, events} = await window.pilot.telemetryShown().catch(() => ({on: true, events: []}));
  $('telemetry-on').checked = on;
  $('telemetry-events').textContent = events.length ? events.map(item => JSON.stringify(item, null, 1)).join('\n\n') : 'Nothing sent yet.';
}

export async function init() {
  window.addEventListener('error', event => report({type: event.error?.name || 'Error', message: event.message,
    stack: event.error?.stack || `${event.filename}:${event.lineno}`}));
  window.addEventListener('unhandledrejection', event => report({type: event.reason?.name || 'Rejection',
    message: event.reason?.message || String(event.reason), stack: event.reason?.stack}));
  $('telemetry-on').addEventListener('change', async event => { await window.pilot.telemetrySet(event.target.checked); show(); });
  document.querySelector('.telemetry-shown').addEventListener('toggle', show);
  show();
}
