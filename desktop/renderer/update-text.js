// Settings → Diagnostics → Updates: whether this is the latest version, from main's updateStatus.
import {ago} from './jobs-view.js';

export function updateText({offer, checkedAt, trial} = {}, now = Date.now()) {
  if (offer) return {latest: false, text: `Version ${offer.version} is available: use Update in the sidebar`};
  if (!checkedAt) return {latest: false, text: 'Not checked yet'};
  if (trial) return {latest: true, text: `${trial} · checked ${ago(checkedAt, now)}`};  // a test build on trial (lib/canary.js)
  return {latest: true, text: `Up to date · checked ${ago(checkedAt, now)}`};
}
