// The one "Claude ready" check (owner, 10 Oct 2026; spec docs/superpowers/specs/2026-10-10-claude-finishes-stuck-pages.md): Claude is offered only when the AI
// engine is Claude, Claude Code is installed and signed in (and Git for Windows is there on Windows). `claudeAuto` ("always let Claude finish when I'm stuck",
// Settings) only counts while that holds. The window's twin is renderer/claude-help.js. Guarded by test/claude-ready.test.js.
import {claudeFamily} from './ai/names.js';
import {claudePrereqs} from './apply.js';

let cached = null;   // the install check reads files: once every 30 s is plenty for the panel's reports
export const _resetClaudeReady = () => { cached = null; };

export function claudeOffered(storage, prereqs = claudePrereqs) {
  if (!claudeFamily(storage)) return false;
  if (!cached || Date.now() - cached.at > 30000) { const p = prereqs(); cached = {at: Date.now(), ok: !!p.claude && !!p.signedIn && (!p.windows || !!p.git)}; }
  return cached.ok;
}
export const claudeAutoOn = (storage, prereqs) => !!storage.settings().claudeAuto && claudeOffered(storage, prereqs);
