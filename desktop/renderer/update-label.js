// The sidebar's update button: one short line from the version ("Update to 0.5.1 beta"); the release's full title, which names the
// channel ("🧪 BETA (release candidate) · 0.5.1 · 4 Oct"), goes in the tooltip. The title in the button wrapped to three lines (4 Oct 2026).
export const updateLabel = update => (update.rollback ? `Back to ${update.version}` : `Update to ${update.version}${update.beta ? ' beta' : ''}`);
export const updateTooltip = update => `${update.name || update.version} is ready: click to install it and restart. What's new: ${update.url}`;
