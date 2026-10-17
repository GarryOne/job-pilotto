// The AI a question judgment runs on: Claude Code when the user chose it, else the Anthropic key (none: no new verdicts, the shape rules still apply).
import * as claudeCode from './claude-code.js';

export const claudeAi = storage => ({apiKey: storage.secret('ANTHROPIC_API_KEY'), client: claudeCode.client(storage)});
