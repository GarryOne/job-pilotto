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
  // PostHog (EU): page views and Download clicks only. No cookies, no storage of an id: each page load is anonymous
  // ($process_person_profile false), IP and location are discarded. Same public project key as the app.
  const KEY = 'phc_ueCQ3oQokV6nFCPvFFRVvsVTMfB5n2KXJmE8NW3RS5vv';
  const send = (event, extra) => {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const props = {$process_person_profile: false, $geoip_disable: true, page, source, ...extra};
    const payload = JSON.stringify({api_key: KEY, event, distinct_id: id, properties: props});
    try { fetch('https://eu.i.posthog.com/capture/', {method: 'POST', body: payload, keepalive: true}).catch(() => {}); } catch { /* blocked: skip */ }
  };
  send('$pageview', {$current_url: location.origin + page});
  for (const link of document.querySelectorAll('a[href^="/download/"]')) {
    link.addEventListener('click', () => send('download_click', {target: link.getAttribute('href').split('?')[0]}));
    const url = new URL(link.href);
    url.searchParams.set('page', page);
    url.searchParams.set('src', source);
    link.href = url.pathname + url.search;
  }
})();
