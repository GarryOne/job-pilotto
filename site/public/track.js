// Counts this page view (POST /api/hit) and tags the Download links with this page and where the visitor came from.
// No cookies; see src/stats.js. The links work without this script too (/download/mac → the GitHub release file).
(() => {
  let source = 'direct';
  try {
    const utm = new URLSearchParams(location.search).get('utm_source');
    const host = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : '';
    const fresh = utm || (host && host !== location.hostname.replace(/^www\./, '') ? host : '');
    source = fresh || sessionStorage.getItem('jp-source') || 'direct';
    sessionStorage.setItem('jp-source', source);  // keep the first outside source for the whole visit
  } catch { /* storage blocked: count as direct */ }
  const page = location.pathname.replace(/\/index\.html$/, '/');
  const body = JSON.stringify({page, source});
  if (!(navigator.sendBeacon && navigator.sendBeacon('/api/hit', body))) {
    fetch('/api/hit', {method: 'POST', body, keepalive: true}).catch(() => {});
  }
  // The install command (and its Copy button) carries where this visit came from, so the install can be traced to a
  // channel: curl -fsSL "…/install?src=reddit-devops" | bash. Direct visits keep the plain command.
  const slug = source.toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40);
  if (slug && slug !== 'direct') {
    const plain = /curl -fsSL (https:\/\/[^\s"|]+\/install) \| bash/;
    const tagged = text => text.replace(plain, (_, url) => `curl -fsSL "${url}?src=${slug}" | bash`);
    for (const code of document.querySelectorAll('code')) if (plain.test(code.textContent)) code.textContent = tagged(code.textContent);
    for (const button of document.querySelectorAll('[data-copy]')) button.dataset.copy = tagged(button.dataset.copy);
  }
  for (const link of document.querySelectorAll('a[href^="/download/"]')) {
    const url = new URL(link.href);
    url.searchParams.set('page', page);
    url.searchParams.set('src', source);
    link.href = url.pathname + url.search;
  }
})();
