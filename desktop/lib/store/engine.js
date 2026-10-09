// One store method through the engine: `python -m src.stores call <entity> <method> '<json>'` (src/stores/__main__.py), so the store on
// this Mac is reached through the engine's own adapter and its schema is never copied here. Its stdout is {"result": …} or {"error": …};
// a line on stderr may say the engine follows the app's folder. Guarded by test/store-runs.test.js.
import * as pipelineRun from '../pipeline-run.js';

export async function call(storage, entity, method, kwargs = {}, {run = pipelineRun.run} = {}) {
  const {code, stdout} = await run(storage, ['src.stores', 'call', entity, method, JSON.stringify(kwargs)]);
  const last = String(stdout || '').trim().split('\n').pop();
  let answer;
  try { answer = JSON.parse(last); } catch { answer = null; }
  if (!answer) throw new Error(`The store did not answer ${entity}.${method} (exit ${code})`);
  if (code !== 0 || 'error' in answer) throw new Error(`The store refused ${entity}.${method}: ${answer.error || `exit ${code}`}`);
  return answer.result;
}
