// Settings live in chrome.storage.local: the Worker connection and the contact details the
// fill step types into forms. Nothing here is sent anywhere except the token, to your own Worker.
const PROFILE = ['first_name', 'last_name', 'full_name', 'email', 'phone', 'location', 'linkedin', 'github', 'website'];
const $ = id => document.getElementById(id);
const stored = await chrome.storage.local.get(['workerUrl', 'token', 'profile']);
$('workerUrl').value = stored.workerUrl || '';
$('token').value = stored.token || '';
for (const key of PROFILE) $(key).value = stored.profile?.[key] || '';

$('save').addEventListener('click', async () => {
  const profile = Object.fromEntries(PROFILE.map(key => [key, $(key).value.trim()]).filter(([, value]) => value));
  await chrome.storage.local.set({workerUrl: $('workerUrl').value.trim(), token: $('token').value.trim(), profile});
  $('saved').textContent = 'Saved ✓';
  setTimeout(() => { $('saved').textContent = ''; }, 2000);
});
