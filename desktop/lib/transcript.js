// A finished Apply-with-Claude session as a conversation, read from Claude Code's transcript (JSON lines): Claude's
// messages as written (Markdown, unwrapped), your messages, and its tool calls as short steps. The session log shows
// it as page text: a recorded terminal screen is wrapped at the width it had and can't reflow to the log's width.
import fs from 'node:fs';
import path from 'node:path';
import {markdownBlocks} from './notion.js';   // Notion-only: the 💬 Conversation toggle's blocks on a Notion Agent Runs row (session-runs.js); the format only, no call

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

// ---- In Notion: the conversation on the session's 🤖 Agent Runs row, folded ("💬 Conversation"), so it outlives the
// Mac's transcript file (Claude Code deletes old ones) and reads on any device. Written when the session ends. ----
export const HEADING = '💬 Conversation';
const PER_CALL = 90;  // Notion takes 100 blocks per append
const text = content => [{type: 'text', text: {content: String(content).slice(0, 2000)}}];
const clock = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 5); };

// The conversation as Notion blocks: "You · 21:42" / "Claude · 21:47" in bold, the message under it, steps folded.
export function blocks(talk) {
  const out = [];
  for (const entry of talk) {
    if (entry.kind === 'steps') {
      out.push({type: 'toggle', toggle: {rich_text: text(`${entry.steps.length} step${entry.steps.length === 1 ? '' : 's'} · ${entry.steps.at(-1)}`),
        children: entry.steps.slice(0, 99).map(line => ({type: 'bulleted_list_item', bulleted_list_item: {rich_text: text(line)}}))}});
      continue;
    }
    const who = [entry.kind === 'you' ? 'You' : 'Claude', clock(entry.at)].filter(Boolean).join(' · ');
    out.push({type: 'paragraph', paragraph: {rich_text: [{type: 'text', text: {content: who}, annotations: {bold: true}}]}});
    out.push(...(entry.kind === 'claude' ? markdownBlocks(entry.text) : [{type: 'paragraph', paragraph: {rich_text: text(entry.text)}}]));
  }
  return out;
}

async function children(call, id) {
  const all = [];
  let cursor;
  do {
    const page = await call('GET', `blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    all.push(...(page.results || []));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return all;
}
const plain = block => (block?.[block.type]?.rich_text || []).map(part => part.plain_text ?? part.text?.content ?? '').join('');

// Writes (or replaces) the conversation on the row page. Returns how many entries it holds.
export async function save(call, page, talk) {
  if (!page || !talk?.length) return 0;
  for (const block of await children(call, page)) if (block.type === 'toggle' && plain(block).startsWith(HEADING)) await call('DELETE', `blocks/${block.id}`);
  const made = await call('PATCH', `blocks/${page}/children`, {children: [{type: 'toggle', toggle: {rich_text: text(`${HEADING} · ${talk.length} messages and steps`)}}]});
  const toggle = made.results?.[0]?.id;
  const all = blocks(talk);
  for (let i = 0; i < all.length; i += PER_CALL) await call('PATCH', `blocks/${toggle}/children`, {children: all.slice(i, i + PER_CALL)});
  return talk.length;
}

// The conversation read back from the row (when the Mac's transcript file is gone): the same entries, steps as their
// summary line only (their list stays in Notion, folded).
export async function load(call, page) {
  const toggle = (await children(call, page)).find(block => block.type === 'toggle' && plain(block).startsWith(HEADING));
  if (!toggle) return null;
  const out = [];
  for (const block of await children(call, toggle.id)) {
    const line = plain(block);
    const who = block.type === 'paragraph' && block.paragraph.rich_text?.[0]?.annotations?.bold && /^(You|Claude)( · \d\d:\d\d)?$/.exec(line);
    if (who) { out.push({kind: who[1] === 'You' ? 'you' : 'claude', text: '', time: (who[2] || '').replace(' · ', '')}); continue; }
    if (block.type === 'toggle') { const [count, ...rest] = line.split(' · '); out.push({kind: 'steps', steps: [rest.join(' · ')], count: parseInt(count, 10) || 1}); continue; }
    const last = out.at(-1);
    if (!last || last.kind === 'steps') continue;
    const marked = (block[block.type]?.rich_text || []).map(part => { const words = part.plain_text ?? part.text?.content ?? ''; return part.annotations?.bold ? `**${words}**` : part.annotations?.code ? `\`${words}\`` : words; }).join('');
    const mark = block.type === 'bulleted_list_item' ? '- ' : block.type === 'numbered_list_item' ? '1. ' : block.type.startsWith('heading') ? '### ' : '';
    last.text += `${last.text ? '\n' : ''}${mark}${marked}`;
  }
  return out;
}
