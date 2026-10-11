// One row case (case.json `replay: "row"`, made by npm run row-to-case) replayed the way CI replays it: on the row path (lib/row-replay.mjs, the case's pages, presses and kept model answers, nothing from
// the network) and judged by its `expect` (lib/row-signature.mjs). A cold ask (a model call not in the case's kept answers: CI has no claude -p) and an address the case never recorded fail it too.
// -> {name, ok, failures, seconds}. replay: injectable for tests. Used by e2e/test/recorded-pages.test.mjs and row-to-case.mjs. Guard: e2e/test/row-case-run.test.mjs.
import {checkSignature, signatureOf} from './row-signature.mjs';
import {replayRow} from './row-replay.mjs';

export const isRowCase = item => item?.replay === 'row';

export async function runRowCase(item, {extensionDir, replay = replayRow} = {}) {
  const failures = [];
  if (!item.expect || !Object.keys(item.expect).length) failures.push('no expect: a row case gets its expect from row-to-case (the new build\'s replay), never by hand');
  const result = await replay(item.dir, {extensionDir});
  failures.push(...checkSignature(signatureOf(result), item.expect));
  if (result.misses) failures.push(`${result.misses} model ask(s) not in the case's kept answers (CI has no claude -p; row-to-case --ask-cold keeps them)`);
  for (const address of result.unrecorded || []) failures.push(`address not recorded: ${address}`);
  return {name: item.name, ok: !failures.length, failures, confirm: [], seconds: result.seconds, signature: signatureOf(result)};
}
