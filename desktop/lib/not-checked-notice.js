// The notification for a Gmail check that read nothing (not connected, sign-in revoked): "not checked", never "had problems". Guarded by test/gmail-not-checked-one-state.test.js.
import {notChecked} from '../renderer/run-status.js';

export function notCheckedNotice(run) {
  if (!notChecked(run)) return null;
  const where = run.where === 'github' ? ' (on GitHub)' : '';
  return {title: `Gmail check not checked${where}`, body: run.off ? 'Gmail is not connected: open Jobadabra to connect it.' : 'Open Jobadabra to see why and what to do.',
    ...(run.id == null ? {} : {target: {run: run.id}})};   // a click opens that run's result, as for every notice
}
