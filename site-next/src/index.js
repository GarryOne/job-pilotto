// The preview site serves its own pages. Anything that is not a page (downloads, the install script, the APIs) is
// handled by the live site, so the buttons work, but the preview keeps no data of its own.
const LIVE = 'https://www.jobpilotto.top';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    // Page-view counting: not for previews, so the live site's stats stay clean.
    if (url.pathname === '/api/hit') return new Response(null, {status: 204});
    // A Pro sign-up from the preview is still a real person: hand it to the live site's waitlist.
    if (url.pathname === '/api/waitlist' && request.method === 'POST') return fetch(new Request(LIVE + url.pathname, request));
    return Response.redirect(LIVE + url.pathname + url.search, 302);
  },
};
