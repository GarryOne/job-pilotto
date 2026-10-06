// The judge rates severity (6 Oct 2026). A detector that cannot see what a finding does to a person filed a fixed level: every failed step and every console error
// "medium", so 68 of 81 issues were medium and the label told nothing (#307, a menu left open on scroll, ranked P1; #306, #310, #315, test mistakes, "medium"). The verdict
// pass reads the code and the screen, so its `Severity:` line (the owner's rubric, ui-verdict-prompt.md) sets the level: before filing (triage.mjs) and after (ui-verdict.yml,
// severity.mjs). The AI review's own cap still holds for its kinds: only a wrong app stays high without a stated workaround (lib/vision.mjs). Pure.
import {cappedSeverity} from './vision.mjs';
import {parse} from './verdict-comment.mjs';

// -> 'high' | 'medium' | 'low', or '' (no rating, or a verdict that says the finding is not the product's).
export function judgedSeverity(raw, finding = {}) {
  const {word, severity} = parse(raw);
  if (!severity || !['real', 'needs-human'].includes(word)) return '';
  return finding.source === 'ai-review' ? cappedSeverity(severity, finding.kind, finding.workaround) : severity;
}

// An issue body with its level changed ("**MEDIUM** · test-failure ·" -> "**HIGH** · …", the emoji too): score() and priorityOf() read it there.
const EMOJI = {high: '🔴', medium: '🟠', low: '🟡'};   // lib/triage.mjs DOT
export function withSeverity(body, severity) {
  const level = String(severity).toUpperCase();
  return String(body || '').replace(/^(?:[🔴🟠🟡🟢]\s*)?\*\*(HIGH|MEDIUM|LOW)\*\*/u, `${EMOJI[severity] || ''} **${level}**`.trim());
}
export const severityOfBody = body => /\*\*(HIGH|MEDIUM|LOW)\*\*/.exec(String(body || ''))?.[1]?.toLowerCase() || '';
