// The extension's three calls for "Read refused sites in my browser" (lib/refused-reads.js): what to read, a page it fetched, the pass ended. main.js passes in the
// services they share. Not a flow file: nothing here touches an application. Guard: test/refused-reads.test.js.
import * as refused from './refused-reads.js';
import * as server from './server.js';
import * as now from './refused-now.js';

export function registerRefusedReadsHandlers({allowanceBlock, log, storage}) {
  server.setVisitRoute('/extension/refused-pending', () => ({ok: true, pending: refused.settingOn(storage) && now.pending() && !refused.passRunning()}));   // the extension's one-minute look: a Read now waits for it
  server.setVisitRoute('/extension/refused-queue', payload => refused.queue(storage, {allowed: payload?.allowed !== false, incognito: payload?.incognito !== false, log, allowanceBlock}));
  server.setVisitRoute('/extension/refused-judge', payload => refused.judge(storage, payload));
  server.setVisitRoute('/extension/refused-outcome', payload => refused.outcome(storage, payload));
  server.setVisitRoute('/extension/refused-done', async () => { await refused.done(); return {ok: true}; });
}
