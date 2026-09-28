// Settings: only the connection to the Job Pilotto app (filled in by Connect). The user's contact details
// and CV live in the app, which the extension asks for each time it fills a form (flow.js).
import {pair} from './flow.js';

const $ = id => document.getElementById(id);
const stored = await chrome.storage.local.get(['workerUrl', 'token', 'checkEligibility', 'testMode', 'clickDropdowns', 'acceptConsents']);
// Every site: an optional permission, granted only by Chrome's own prompt from this click.
const EVERY_SITE = {origins: ['https://*/*']};
$('anySite').checked = await chrome.permissions.contains(EVERY_SITE);
$('anySite').addEventListener('change', async () => {
  const on = $('anySite').checked;
  const ok = await (on ? chrome.permissions.request(EVERY_SITE) : chrome.permissions.remove(EVERY_SITE)).catch(() => false);
  if (on && !ok) $('anySite').checked = false;
});
$('acceptConsents').checked = stored.acceptConsents === true;
$('acceptConsents').addEventListener('change', () => chrome.storage.local.set({acceptConsents: $('acceptConsents').checked}));
// Chrome grants debugger only at install (it can't be optional); this switch decides whether it's used.
$('clickDropdowns').checked = stored.clickDropdowns !== false;  // on by default
$('clickDropdowns').addEventListener('change', () => chrome.storage.local.set({clickDropdowns: $('clickDropdowns').checked}));
$('testMode').checked = stored.testMode === true;
$('testMode').addEventListener('change', () => chrome.storage.local.set({testMode: $('testMode').checked}));
$('checkEligibility').checked = stored.checkEligibility !== false;
$('checkEligibility').addEventListener('change', () => chrome.storage.local.set({checkEligibility: $('checkEligibility').checked}));
$('workerUrl').value = stored.workerUrl || '';
$('token').value = stored.token || '';

async function connectToApp() {
  $('pair-status').textContent = 'Looking for the Job Pilotto app on this Mac…';
  try {
    const {workerUrl, token} = await pair();
    $('workerUrl').value = workerUrl;
    $('token').value = token;
    $('pair-status').textContent = 'Connected to the Job Pilotto app ✓';
  } catch (error) {
    $('pair-status').textContent = `Couldn't reach the Job Pilotto app (${error.message}). Open the app, then try again.`;
  }
}
$('pair').addEventListener('click', connectToApp);
if (!stored.token) connectToApp();

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({workerUrl: $('workerUrl').value.trim(), token: $('token').value.trim()});
  $('saved').textContent = 'Saved ✓';
  setTimeout(() => { $('saved').textContent = ''; }, 2000);
});
