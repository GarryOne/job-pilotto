// Settings → Diagnostics → Updates: whether this is the latest version, from main's updateStatus.
import {ago} from './jobs-view.js';

export function updateText({offer, checkedAt, fromSource} = {}, now = Date.now()) {
  if (fromSource) return {latest: true, text: 'Running from source: update with git pull'};
  if (offer) return {latest: false, text: `Version ${offer.version} is available: use Update in the sidebar`};
  if (!checkedAt) return {latest: false, text: 'Not checked yet'};
  return {latest: true, text: `Up to date · checked ${ago(checkedAt, now)}`};
}
