// The hosted Always on runner Worker (spec 2026-10-16-hosted-always-on.md §1): consumes the Queue "hosted-runs" and starts one engine container per message (src/hosted-consume.js has the logic).
// A separate Worker because the Container class needs @cloudflare/containers, which the site's tests cannot load. Deployed by .github/workflows/site.yml next to the site.
import {Container, getContainer} from '@cloudflare/containers';
import {consume} from '../src/hosted-consume.js';

export class HostedRunner extends Container {
  defaultPort = 8080;
  sleepAfter = '2m';   // billed only while it runs; it stops by itself after the run
}

export default {
  async queue(batch, env) { await consume(batch, account => getContainer(env.RUNNER, account)); },
  async fetch() { return new Response('Not found', {status: 404}); },
};
