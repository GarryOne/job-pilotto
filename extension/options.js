// Settings live in chrome.storage.local: the Worker connection and the contact details the
// fill step types into forms. Nothing here is sent anywhere except the token, to your own Worker.
const PROFILE = ['first_name', 'last_name', 'full_name', 'email', 'phone', 'location', 'linkedin', 'github', 'website'];
const $ = id => document.getElementById(id);
const stored = await chrome.storage.local.get(['workerUrl', 'token', 'profile', 'resume']);
let resume = stored.resume || null;
const showResume = () => { $('resume-current').textContent = resume ? `Stored: ${resume.name} (${Math.round(resume.data.length * 0.75 / 1024)} KB). Choose a file to replace it.` : 'No CV stored yet. It\'s attached to application forms you fill.'; };
showResume();
$('workerUrl').value = stored.workerUrl || '';
$('token').value = stored.token || '';

// The Job Pilotto Mac app gives its connection to this extension only (it checks the extension's ID).
const APP = 'http://127.0.0.1:47111';
async function connectToApp(quiet) {
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
    $('pair-status').textContent = quiet ? '' : `Couldn't reach the Job Pilotto app (${error.message}). Open the app, then try again.`;
  }
}
$('pair').addEventListener('click', () => connectToApp(false));
if (!stored.token) connectToApp(false);
for (const key of PROFILE) $(key).value = stored.profile?.[key] || '';

$('resume').addEventListener('change', async () => {
  const file = $('resume').files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { $('resume-current').textContent = 'That file is over 5 MB; choose a smaller PDF.'; return; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  resume = {name: file.name, type: file.type || 'application/pdf', data: btoa(binary)};
  showResume();
});

$('save').addEventListener('click', async () => {
  const profile = Object.fromEntries(PROFILE.map(key => [key, $(key).value.trim()]).filter(([, value]) => value));
  await chrome.storage.local.set({workerUrl: $('workerUrl').value.trim(), token: $('token').value.trim(), profile, resume});
  $('saved').textContent = 'Saved ✓';
  setTimeout(() => { $('saved').textContent = ''; }, 2000);
});
