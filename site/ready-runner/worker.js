// The Ready to send runner Worker (spec docs/superpowers/specs/2026-10-17-ready-to-send.md): consumes the Queue "ready-runs" and starts one night's container per message (src/ready-consume.js has the logic), and carries the owner's
// morning calls to that container: the site Worker reaches it through a service binding only (workers_dev is off, there is no public route). NOT DEPLOYED: it needs a Queue and a Worker on the Cloudflare account, which the owner has not agreed to yet.
// A separate Worker because the Container class needs @cloudflare/containers, which the site's tests cannot load.
import {Container, getContainer} from '@cloudflare/containers';
import {consume} from '../src/ready-consume.js';

export class ReadyRunner extends Container {
  defaultPort = 8080;
  sleepAfter = '3h';   // the filled tabs are held until the morning; each request from the owner renews it, and "close" ends it at once
}

const TO_CONTAINER = {live: 'ws', handoff: 'handoff', held: 'state', close: 'close'};   // what the site Worker asks -> the container's path

export default {
  async queue(batch, env) { await consume(batch, night => getContainer(env.READY, night)); },
  async fetch(request, env) {
    const url = new URL(request.url), path = TO_CONTAINER[url.pathname.slice(1)], night = url.searchParams.get('batch');
    if (!path || !night) return new Response('Not found', {status: 404});
    const container = getContainer(env.READY, night);
    const reply = await container.fetch(new Request(`http://container/${path}?t=${encodeURIComponent(url.searchParams.get('t') || '')}&job=${encodeURIComponent(url.searchParams.get('job') || '')}`, request));
    if (path === 'close' || [401, 410].includes(reply.status)) await container.stop().catch(() => {});   // 410 (or 401 from an older image: the site's token is always right): the call woke a fresh container that holds no night; it is not kept awake for 3 h
    return reply;
  },
};
