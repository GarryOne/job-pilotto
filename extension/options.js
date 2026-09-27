// Settings: only the connection to the Job Pilotto app (filled in by Connect). The user's contact details
// and CV live in the app, which the extension asks for each time it fills a form (flow.js).
const $ = id => document.getElementById(id);
const stored = await chrome.storage.local.get(['workerUrl', 'token', 'checkEligibility']);
$('checkEligibility').checked = stored.checkEligibility !== false;
$('checkEligibility').addEventListener('change', () => chrome.storage.local.set({checkEligibility: $('checkEligibility').checked}));
$('workerUrl').value = stored.workerUrl || '';
$('token').value = stored.token || '';

// The Job Pilotto Mac app gives its connection to this extension only (it checks the extension's ID).
const APP = 'http://127.0.0.1:47111';
async function connectToApp() {
  $('pair-status').textContent = 'Looking for the Job Pilotto app on this Mac…';
  try {
    const response = await fetch(`${APP}/extension/pair`);
    if (!response.ok) throw new Error(`the app answered ${response.status}`);
    const {url, token} = await response.json();
    $('workerUrl').value = url;
    $('token').value = token;
    await chrome.storage.local.set({workerUrl: url, token});
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
