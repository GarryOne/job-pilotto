// One switch for every way into Claude (owner, 9 Oct 2026: "the extension and Chrome flow is smart … Resume with Claude or Apply with Claude is a degraded experience;
// it is slow, it confuses non-technical users"). Settings → Application assistant (settings.claudeConsent; off on a new install). Off: the extension's flow is the only
// one shown: no Resume Claude, Apply with Claude, Tell Claude, Read with Claude (Find employers' stopped sites) or Claude option in the Apply dialog. On: they are back, always as the second option, never the main one.
// Every entry point asks this; test/claude-help.test.js fails when a new Claude button is added without it.
// And only for the Claude family: with OpenAI or Codex chosen, every Claude entry point is hidden (owner, 9 Oct 2026; Codex cannot drive Chrome).
import {claudeFeatures} from './ai-name.js';
import {shared} from './pages/shared.js';

export const claudeHelp = () => !!shared.state?.settings?.claudeConsent && claudeFeatures();
