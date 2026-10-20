// A page's CDP screencast to numbered JPEG files with each frame's own time, and the step log both recorders share (desktop/scripts/media).
// The renderer resamples the frames to a fixed rate, so an uneven capture rate never changes the video's speed.
import fs from 'node:fs';
import path from 'node:path';

export async function startScreencast(page, dir, {quality = 92, maxWidth = 3600, maxHeight = 2250} = {}) {
  fs.mkdirSync(dir, {recursive: true});
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let t0 = null;
  cdp.on('Page.screencastFrame', frame => {
    cdp.send('Page.screencastFrameAck', {sessionId: frame.sessionId}).catch(() => {});
    if (t0 == null) return;
    const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(frame.data, 'base64'));
    frames.push({t: Math.max(0, frame.metadata.timestamp - t0), file});
  });
  await cdp.send('Page.startScreencast', {format: 'jpeg', quality, maxWidth, maxHeight, everyNthFrame: 1});
  await page.waitForTimeout(300);
  t0 = Date.now() / 1000;
  return {
    clock: () => Date.now() / 1000 - t0,
    stop: async () => {
      await cdp.send('Page.stopScreencast').catch(() => {});
      await cdp.detach().catch(() => {});
      if (!frames.length) throw new Error('media: the screencast sent no frame');
      return frames;
    },
  };
}

// The click log: each event stamped with the screencast's clock.
export function stepLog(clock) {
  const events = [];
  return {events, add: event => events.push({t: Number(clock().toFixed(3)), ...event})};
}
