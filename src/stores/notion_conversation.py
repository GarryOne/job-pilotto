"""An Apply session's conversation as Notion blocks and back: the "💬 Conversation" toggle on its 🤖 Agent Runs row.

A port of desktop/lib/transcript.js (blocks, load) and of the desktop's markdownBlocks (desktop/lib/notion-write.js), so a
conversation written by the engine (a move to Notion, apply_run) and one written by the app are the same blocks. The
conversation is [{kind: 'you'|'claude'|'steps', text | steps, at}]; read back, a message carries `time` (HH:MM) instead of
`at`, and steps only their summary line (`steps`: [last], `count`), as the app's reader gives them. Both sides test
tests/fixtures/stores/conversation*.json. Guarded by tests/test_store_conversation.py.
"""
import re
from datetime import datetime

HEADING = '💬 Conversation'


def _text(content):
    return [{'type': 'text', 'text': {'content': str(content)[:2000]}}]


def _clock(iso):
    """The local HH:MM of an ISO time, as the app's Date.toTimeString gives it ('' when unreadable)."""
    try:
        return datetime.fromisoformat(str(iso).replace('Z', '+00:00')).astimezone().strftime('%H:%M')
    except (TypeError, ValueError):
        return ''


def _rich(text):
    """notion-write.js rich(): **bold** and `code` runs, the rest plain."""
    out = []
    for piece in filter(None, re.split(r'(\*\*[^*]+\*\*|`[^`]+`)', text)):
        bold, code = piece.startswith('**'), piece.startswith('`')
        content = piece[2:-2] if bold else piece[1:-1] if code else piece
        out.append({'type': 'text', 'text': {'content': content[:2000]}, 'annotations': {'bold': bold, 'code': code}})
    return out


def markdown_blocks(text):
    """notion-write.js markdownBlocks(): one block per line (headings, - and 1. items, paragraphs), | rows as a table."""
    blocks, table = [], []

    def flush():
        rows = [[cell.strip() for cell in re.sub(r'^\||\|$', '', row.strip()).split('|')]
                for row in table if not re.match(r'^\|\s*:?-', row)]
        if rows:
            width = max(len(row) for row in rows)
            blocks.append({'type': 'table', 'table': {'table_width': width, 'has_column_header': True, 'has_row_header': False,
                                                      'children': [{'type': 'table_row', 'table_row': {'cells': [
                                                          _rich(cell) for cell in row + [''] * (width - len(row))]}} for row in rows]}})
        table.clear()
    for line in re.split(r'\r?\n', text or ''):
        if line.startswith('|'):
            table.append(line)
            continue
        flush()
        if not line.strip():
            continue
        heading = re.match(r'^(#{1,3})\s+(.*)', line)
        if heading:
            kind = f'heading_{len(heading.group(1))}'
            blocks.append({'type': kind, kind: {'rich_text': _rich(heading.group(2))}})
        elif re.match(r'^\s*[-*]\s+', line):
            blocks.append({'type': 'bulleted_list_item', 'bulleted_list_item': {'rich_text': _rich(re.sub(r'^\s*[-*]\s+', '', line))}})
        elif re.match(r'^\s*\d+\.\s+', line):
            blocks.append({'type': 'numbered_list_item', 'numbered_list_item': {'rich_text': _rich(re.sub(r'^\s*\d+\.\s+', '', line))}})
        else:
            blocks.append({'type': 'paragraph', 'paragraph': {'rich_text': _rich(line.strip())}})
    flush()
    return blocks


def blocks(talk):
    """transcript.js blocks(): "You · 21:42" / "Claude · 21:47" in bold, the message under it, steps folded."""
    out = []
    for entry in talk:
        if entry.get('kind') == 'steps':
            steps = entry.get('steps') or []
            out.append({'type': 'toggle', 'toggle': {
                'rich_text': _text(f"{len(steps)} step{'' if len(steps) == 1 else 's'} · {steps[-1] if steps else ''}"),
                'children': [{'type': 'bulleted_list_item', 'bulleted_list_item': {'rich_text': _text(line)}} for line in steps[:99]]}})
            continue
        who = ' · '.join(part for part in ('You' if entry.get('kind') == 'you' else 'Claude', _clock(entry.get('at'))) if part)
        out.append({'type': 'paragraph', 'paragraph': {'rich_text': [{'type': 'text', 'text': {'content': who}, 'annotations': {'bold': True}}]}})
        out += markdown_blocks(entry.get('text') or '') if entry.get('kind') == 'claude' else \
            [{'type': 'paragraph', 'paragraph': {'rich_text': _text(entry.get('text') or '')}}]
    return out


def _plain(block):
    return ''.join(part.get('plain_text', (part.get('text') or {}).get('content', ''))
                   for part in (block.get(block.get('type')) or {}).get('rich_text') or [])


def load(children):
    """transcript.js load(), from the toggle's child blocks: the same entries, steps as their summary line only."""
    out = []
    for block in children:
        line, kind = _plain(block), block.get('type')
        first = ((block.get(kind) or {}).get('rich_text') or [{}])[0]
        who = kind == 'paragraph' and (first.get('annotations') or {}).get('bold') and re.match(r'^(You|Claude)( · \d\d:\d\d)?$', line)
        if who:
            out.append({'kind': 'you' if who.group(1) == 'You' else 'claude', 'text': '', 'time': (who.group(2) or '').replace(' · ', '')})
            continue
        if kind == 'toggle':
            count, _, rest = line.partition(' · ')
            out.append({'kind': 'steps', 'steps': [rest], 'count': int(count.split(' ')[0]) if count.split(' ')[0].isdigit() else 1})
            continue
        if not out or out[-1]['kind'] == 'steps':
            continue
        marked = ''.join(
            f"**{words}**" if (part.get('annotations') or {}).get('bold') else f"`{words}`" if (part.get('annotations') or {}).get('code') else words
            for part in (block.get(kind) or {}).get('rich_text') or []
            for words in [part.get('plain_text', (part.get('text') or {}).get('content', ''))])
        mark = '- ' if kind == 'bulleted_list_item' else '1. ' if kind == 'numbered_list_item' else '### ' if kind.startswith('heading') else ''
        out[-1]['text'] += ('\n' if out[-1]['text'] else '') + mark + marked
    return out


def toggle_title(talk):
    return f'{HEADING} · {len(talk)} messages and steps'
