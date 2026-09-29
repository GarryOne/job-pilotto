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
  for (const link of document.querySelectorAll('a[href^="/download/"]')) {
    const url = new URL(link.href);
    url.searchParams.set('page', page);
    url.searchParams.set('src', source);
    link.href = url.pathname + url.search;
  }
})();
