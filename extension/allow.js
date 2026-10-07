// The extension's own page with the one Allow button (Chrome asks for a site permission only from the extension's own page, on a click).
// Opened by visit.js when a tab the app marked waits for it; once allowed, the waiting tabs start reading and this page closes.
// Only what manifest.json declares (optional_host_permissions): Chrome refuses a request for anything else with no prompt (7 Oct 2026: every Allow
// click said Not allowed, because 'http://*/*' was asked too). test/extension-permissions.test.js checks it.
const ALL_SITES = {origins: ['https://*/*']};
document.getElementById('allow').addEventListener('click', async () => {
  const ok = await chrome.permissions.request(ALL_SITES).catch(() => false);
  const said = document.getElementById('said');
  said.className = ok ? 'done' : '';
  said.textContent = ok ? 'Allowed: the extension is reading the sites now. This page closes by itself.' : 'Not allowed: the sites stay unread. You can still click the Job Pilotto icon on each site.';
  if (ok) setTimeout(() => window.close(), 1500);
});
