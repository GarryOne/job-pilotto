// A finished Apply-with-Claude session as a conversation, read from Claude Code's transcript (JSON lines): Claude's
// messages as written (Markdown, unwrapped), your messages, and its tool calls as short steps. The session log shows
// it as page text: a recorded terminal screen is wrapped at the width it had and can't reflow to the log's width.
import fs from 'node:fs';
import path from 'node:path';

const MAX_ENTRIES = 400;
const cut = (text, limit = 140) => { const one = String(text || '').replace(/\s+/g, ' ').trim(); return one.length > limit ? `${one.slice(0, limit - 1)}…` : one; };
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

// One tool call in a few words ("Opened boards.greenhouse.io", "Ran: Fill the form from the kit").
export function step(name, input = {}) {
  const chrome = /^mcp__claude-in-chrome__(.+)$/.exec(name)?.[1];
  if (chrome) {
    const what = {navigate: 'Opened', computer: 'Used the page', read_page: 'Read the page', find: 'Looked for', form_input: 'Typed in the form',
      get_page_text: 'Read the page text', javascript_tool: 'Ran a script on the page', tabs_context_mcp: 'Checked the tabs', tabs_create_mcp: 'Opened a tab',
      file_upload: 'Uploaded a file', upload_image: 'Uploaded an image'}[chrome] || `Chrome: ${chrome.replace(/_mcp$/, '').replace(/_/g, ' ')}`;
    const detail = input.url ? host(input.url) || input.url : input.query || input.action || input.value || '';
    return `🌐 ${what}${detail ? ` · ${cut(detail, 80)}` : ''}`;
  }
  if (name === 'Bash') return `⚙️ ${cut(input.description || input.command, 120)}`;
  if (name === 'Read') return `📄 Read ${path.basename(String(input.file_path || ''))}`;
  if (name === 'Write' || name === 'Edit') return `✏️ ${name === 'Write' ? 'Wrote' : 'Edited'} ${path.basename(String(input.file_path || ''))}`;
  if (name === 'Skill') return `🧭 Followed the ${input.skill || ''} steps`;
  if (name === 'ToolSearch') return '';
  return `🔧 ${name.replace(/^mcp__[^_]+__/, '').replace(/_/g, ' ')}`;
}

// The conversation: [{kind: 'you'|'claude'|'steps', text | steps: [..], at}], consecutive steps grouped.
export function conversation(file, read = fs.readFileSync) {
  let lines;
  try { lines = String(read(file, 'utf8')).trim().split('\n').slice(-MAX_ENTRIES * 3); } catch { return null; }
  const out = [];
  const push = (kind, value, at) => {
    const last = out.at(-1);
    if (kind === 'steps') { if (!value) return; if (last?.kind === 'steps') last.steps.push(value); else out.push({kind, steps: [value], at}); return; }
    if (value.trim()) out.push({kind, text: value.trim(), at});
  };
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.isMeta || entry.isSidechain) continue;
    const content = entry.message?.content, at = entry.timestamp || '';
    if (entry.type === 'user') {
      if (typeof content === 'string') push('you', content, at);
      else for (const part of content || []) if (part.type === 'text') push('you', part.text, at);
    } else if (entry.type === 'assistant') {
      for (const part of content || []) {
        if (part.type === 'text') push('claude', part.text, at);
        else if (part.type === 'tool_use') push('steps', step(part.name, part.input), at);
      }
    }
  }
  return out.slice(-MAX_ENTRIES);
}
