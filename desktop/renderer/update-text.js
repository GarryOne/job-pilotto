// Settings → Diagnostics → Updates: whether this is the latest version, from main's updateStatus.
import {ago} from './jobs-view.js';

export function updateText({offer, checkedAt, fromSource} = {}, now = Date.now()) {
  if (fromSource) return {latest: true, text: 'Running from source: update with git pull'};
  if (offer) return {latest: false, text: `Version ${offer.version} is available: use Update in the sidebar`};
  if (!checkedAt) return {latest: false, text: 'Not checked yet'};
  return {latest: true, text: `Up to date · checked ${ago(checkedAt, now)}`};
}

// Settings → Diagnostics → Beta, from main's betaState: {on, current, stable, ahead, fromSource}.
export function betaText({on, current, stable, ahead, fromSource} = {}) {
  if (fromSource) return {text: 'Not in a build run from source', toggle: '', back: false};
  if (ahead) return {text: on ? `On · ahead of stable ${stable}` : `Off · still ahead of stable ${stable}`, toggle: on ? 'Turn off' : 'Join the beta', back: true};
  return {text: on ? 'On · you are offered new versions before everyone else' : 'Off · you get stable versions only', toggle: on ? 'Turn off' : 'Get the beta version', back: false};
}
