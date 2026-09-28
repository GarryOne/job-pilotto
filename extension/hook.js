// Apply with Claude → extension hand-off. A Claude session driving this tab (Claude in Chrome) asks for the
// extension's fast fill by firing, on the form page:
//   document.dispatchEvent(new CustomEvent('jobpilotto:fill', {detail: JSON.stringify({job, ticket})}))
// The ticket comes from the Job Pilotto app when it launched that session, and the extension checks it with
// the app first, so a web page alone can't make the extension fill it. Progress and result are written to
// <html data-jobpilotto-fill='{"state":"received|running|done|error", ...}'>, which the session reads.
// <html data-jobpilotto-hook="<version>"> says the extension is here.
(() => {
  // Once per page, but a copy left behind by an extension reload (its chrome.runtime is gone) lets the new one run.
  if (window.__jobPilottoHookAlive?.()) return;
  window.__jobPilottoHookAlive = () => !!chrome.runtime?.id;
  document.documentElement.dataset.jobpilottoHook = chrome.runtime.getManifest().version;
  document.addEventListener('jobpilotto:fill', event => {
    let request;
    try { request = JSON.parse(event.detail); } catch { return; }
    if (typeof request?.ticket !== 'string' || typeof request?.job !== 'string') return;
    document.documentElement.dataset.jobpilottoFill = JSON.stringify({state: 'received'});
    chrome.runtime.sendMessage({type: 'claudeFill', job: request.job, ticket: request.ticket});
  });
})();
