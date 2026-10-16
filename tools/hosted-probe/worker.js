// The probe Worker for the hosted Always on cost probe: starts one engine container and forwards GET /run to it, behind a one-time token.
import {Container, getContainer} from '@cloudflare/containers';

export class Probe extends Container {
  defaultPort = 8080;
  sleepAfter = '2m';   // billed only while it runs; it stops by itself after the probe
}

export default {
  async fetch(request, env) {
    if (request.headers.get('x-probe-token') !== env.PROBE_TOKEN) return new Response('no', {status: 403});
    return getContainer(env.PROBE, 'one').fetch(request);
  },
};
