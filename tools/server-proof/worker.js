// The proof Worker: our own fake form pages are open (the "user's browser" opens them too); everything else needs the one-time token (header or ?t=). Passes WebSocket upgrades through.
import {Container, getContainer} from '@cloudflare/containers';

export class Proof extends Container {
  defaultPort = 8080;
  sleepAfter = '15m';   // billed only while it runs
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const open = url.pathname.startsWith('/fake') || url.pathname.startsWith('/flow') || url.pathname.startsWith('/apply');
    const token = request.headers.get('x-probe-token') || url.searchParams.get('t');
    if (!open && token !== env.PROBE_TOKEN) return new Response('no', {status: 403});
    return getContainer(env.PROOF, 'one').fetch(request);
  },
};
