// The statistics of an Apply with Claude session, for its row in Notion 🎏 Agent Runs, so the process can be measured
// and improved: how long Claude worked, how long it waited for you, how fast you answered, how many turns, tool calls
// and tokens it used, and what you decided. From the session's timeline (terminals.js) and its Claude Code transcript.
import fs from 'node:fs';

const minutes = ms => Math.round(ms / 600) / 100;  // two decimals
const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// From the timeline [{at, status}]: time working and waiting, how often it asked you and how fast you answered, and
// the time from "ready for review" (form filled, or Claude's last question) to your decision.
export function timeline(events = [], {now = Date.now(), decidedAt = null} = {}) {
  let working = 0, waiting = 0, asked = 0, readyAt = null;
  const replies = [];
  const at = event => Date.parse(event.at);
  events.forEach((event, i) => {
    const end = i + 1 < events.length ? at(events[i + 1]) : (/^decided|^ended|^failed/.test(event.status) ? at(event) : now);
    const span = Math.max(0, end - at(event));
    if (event.status === 'running') working += span;
    if (event.status === 'input') {
      waiting += span;
      asked += 1;
      if (events[i + 1]?.status === 'running') replies.push(span / 1000);  // you answered and Claude went on
    }
    if (event.status === 'done' || event.status === 'input') readyAt = at(event);
  });
  const decided = decidedAt ? Date.parse(decidedAt) : null;
  return {workingMin: minutes(working), waitingMin: minutes(waiting), asked, replyMedianS: median(replies) === null ? null : Math.round(median(replies)),
    readyToDecidedMin: decided && readyAt && decided >= readyAt ? minutes(decided - readyAt) : null};
}

// From the Claude Code transcript (JSON lines): your prompts after the first (the app's instructions), tool calls by
// tool, tokens (each message once: its lines repeat the same usage) and the model.
export function transcript(file, read = fs.readFileSync) {
  let text = '';
  try { text = String(read(file, 'utf8')); } catch { return null; }
  const tools = {}, usage = new Map();
  let prompts = 0, model = '';
  for (const line of text.split('\n')) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type === 'assistant') {
      const message = entry.message || {};
      if (message.model) model = message.model;
      for (const part of message.content || []) if (part.type === 'tool_use') tools[part.name] = (tools[part.name] || 0) + 1;
      if (message.id && message.usage) usage.set(message.id, message.usage);
    }
    if (entry.type === 'user' && !entry.isMeta) {
      const content = entry.message?.content;
      if (typeof content === 'string' || (Array.isArray(content) && content.some(part => part.type === 'text'))) prompts += 1;
    }
  }
  const sum = key => [...usage.values()].reduce((total, u) => total + (Number(u[key]) || 0), 0);
  return {turns: Math.max(0, prompts - 1), toolCalls: Object.values(tools).reduce((a, b) => a + b, 0), tools, model,
    tokensIn: sum('input_tokens') + sum('cache_creation_input_tokens'), tokensOut: sum('output_tokens'), cacheRead: sum('cache_read_input_tokens')};
}

// "claude-in-chrome 20 · Bash 7 · Read 1": tools of one MCP server counted together, the most used first.
export function toolsText(tools = {}) {
  const totals = new Map();
  for (const [name, count] of Object.entries(tools)) {
    const short = name.match(/^mcp__(.+?)__/)?.[1] || name;
    totals.set(short, (totals.get(short) || 0) + count);
  }
  return [...totals].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}`).join(' · ');
}

const OUTCOME = {submitted: 'Submitted', 'not submitted': 'Not submitted', restarted: 'Restarted', cancelled: 'Cancelled'};
// One session's numbers as plain values: the store on this Mac keeps them in its agent run's `fields` (src/stores AGENT_RUN_FIELDS);
// properties() turns the same values into Notion's columns, so both stores hold the same.
export function plain(session, {now = Date.now(), read} = {}) {
  const time = timeline(session.events, {now, decidedAt: session.decidedAt});
  const claude = session.transcript ? transcript(session.transcript, read) : null;
  return {
    working_min: time.workingMin ?? null, waiting_min: time.waitingMin ?? null, times_asked: time.asked ?? null,
    reply_median_s: time.replyMedianS ?? null, ready_to_decided_min: time.readyToDecidedMin ?? null,
    outcome: OUTCOME[session.outcome] || 'Open',
    ...(claude ? {turns: claude.turns, tool_calls: claude.toolCalls, tools_used: toolsText(claude.tools), tokens_in: claude.tokensIn,
      tokens_out: claude.tokensOut, cache_read: claude.cacheRead, model: claude.model} : {}),
    timeline: (session.events || []).map(e => `${e.at.slice(11, 19)} ${e.status}`).join(' → '),
  };
}

// The Agent Runs columns (config/notion_schema.json) for one session.
export function properties(session, options) {
  const p = plain(session, options);
  const number = value => ({number: value ?? null});
  const text = value => ({rich_text: value ? [{text: {content: String(value).slice(0, 1900)}}] : []});
  return {
    'Claude working (min)': number(p.working_min), 'Waiting for you (min)': number(p.waiting_min),
    'Times asked': number(p.times_asked), 'Your reply (median s)': number(p.reply_median_s),
    'Ready → decided (min)': number(p.ready_to_decided_min),
    Outcome: {select: {name: p.outcome}},
    ...('turns' in p ? {'Turns': number(p.turns), 'Tool calls': number(p.tool_calls), 'Tools used': text(p.tools_used),
      'Tokens in': number(p.tokens_in), 'Tokens out': number(p.tokens_out), 'Cache read': number(p.cache_read), Model: text(p.model)} : {}),
    'Session timeline': text(p.timeline),
  };
}
