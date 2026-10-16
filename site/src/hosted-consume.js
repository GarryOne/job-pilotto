// Hosted Always on, the Queue consumer's logic (the runner Worker site/hosted-runner/worker.js is only glue around it): each message starts one container run and waits for it.
// A message is always acknowledged: the run token is single-use and the container posts its own result; a run that never posts is failed by the next tick (src/hosted-tick.js).
// Guard: site/test/hosted-guards.test.js.
export const RUN_TIMEOUT_MS = 14 * 60 * 1000;

// `runner(account)` -> {fetch(request)}: the container instance for that account (one at a time per account). -> {ok, failed} counts.
export async function consume(batch, runner, log = console) {
  const done = {ok: 0, failed: 0};
  await Promise.all(batch.messages.map(async message => {
    const {token, site, account} = message.body || {};
    try {
      const reply = await runner(account).fetch(new Request('http://container/run', {method: 'POST', body: JSON.stringify({token, site}), signal: AbortSignal.timeout(RUN_TIMEOUT_MS)}));
      reply.ok ? done.ok++ : done.failed++;
    } catch (error) {
      done.failed++;
      log.error(`hosted run ${message.body?.run}: ${error.message}`);
    }
    message.ack();
  }));
  return done;
}
