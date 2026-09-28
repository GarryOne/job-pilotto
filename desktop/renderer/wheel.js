// The session log's mouse wheel. Claude Code turns on the terminal's mouse reporting and scrolls its own view, so
// while it runs the wheel goes to it. Otherwise (the session ended, or was restored after a restart: nothing reads
// its input) the log scrolls itself; before, xterm still sent every turn of the wheel to the dead session.
export const passWheel = ({live, mouse}) => live && mouse;

// A wheel event → whole lines to scroll, keeping the remainder (trackpads send many small deltas).
// deltaMode 0 = pixels, 1 = lines, 2 = pages.
export function wheelLines({deltaY, deltaMode = 0}, rows, lineHeight, carry = 0) {
  const lines = carry + (deltaMode === 1 ? deltaY : deltaMode === 2 ? deltaY * rows : deltaY / lineHeight);
  const whole = Math.trunc(lines);
  return {lines: whole, carry: lines - whole};
}
