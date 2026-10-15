// One switch for every way into Claude (owner, 9 Oct 2026: "the extension and Chrome flow is smart … Resume with Claude or Apply with Claude is a degraded experience;
// it is slow, it confuses non-technical users"). Since 10 Oct 2026 (spec 2026-10-10-claude-finishes-stuck-pages.md, part 4) there is no "Show Claude help" switch: Claude is
// offered only when it is READY: a Claude engine, Claude Code installed and signed in (and Git for Windows there), the twin of lib/claude-ready.js. A non-technical user has no
// Claude Code, so never sees it. The consent is asked at the first press (settings.claudeConsent); "always let Claude finish" is settings.claudeAuto.
// Every entry point asks this; test/claude-help.test.js fails when a new Claude button is added without it.
// And only for the Claude family: with OpenAI or Codex chosen, every Claude entry point is hidden (owner, 9 Oct 2026; Codex cannot drive Chrome).
import {claudeFeatures} from './ai-name.js';

let installed = false;   // Claude Code installed and signed in (and Git on Windows), from the main process
export const claudeHelp = () => installed && claudeFeatures();
// "Resume Claude" is hidden everywhere for now (owner, 15 Oct 2026: it is rung 6, "we never want to get there when Claude takes over, it's already a poor experience; we should be the
// interface between the user and Claude"). The code stays: true brings back the session card's button, its ⋯ menu entry and the log banner's button.
// test/resume-hidden.test.js fails when a Resume Claude entry is built without asking resumeOffered.
export const SHOW_RESUME_CLAUDE = false;
export const resumeOffered = () => SHOW_RESUME_CLAUDE && claudeHelp();

// Asks the main process what is installed; every entry point redraws when it changed (the 'claude-help' event).
export async function refreshClaudeHelp() {
  const p = await window.pilot.claudePrereqs().catch(() => null);
  const now = !!p && !!p.claude && !!p.signedIn && (!p.windows || !!p.git);
  if (now !== installed) { installed = now; window.dispatchEvent(new Event('claude-help')); }
}
