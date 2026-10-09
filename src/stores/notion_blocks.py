"""Markdown ↔ Notion blocks: how a store's Markdown fields (a job's sections, an interview's review, an insight's body)
become the blocks a Notion page shows, and back.

The one codec of the Notion adapter (src/stores/notion*.py import it; never a second one). Covered:
  paragraphs, `#`/`##`/`###` headings, `- ` and `1. ` lists, ``` code (with a language), `> ` quotes,
  **bold**, *italic*, `code` and [links](url) inside text, and children: any block's children follow it indented by
  two spaces. A toggleable heading is written `## ▸ Title` with its body indented below it.
A character that would start one of these is escaped with a backslash, so text read from Notion comes back as written.
Rich text is cut into parts of at most 1900 characters (Notion allows 2000), 100 parts a block; a longer paragraph
goes on in further blocks. Not kept: blank lines inside one paragraph (Markdown makes two paragraphs of them) and
leading spaces on a paragraph's later lines. Other Notion blocks (callouts, to-dos) come back as their text.
Also the columns: value(property, kind) and column(kind, value) for title, text, select, date, number and checkbox.
Guarded by tests/test_store_notion_blocks.py (round trips, and today's interview page blocks).
"""
import re

PART = 1900      # characters per rich-text part
PARTS = 100      # parts per block
TOGGLE = '▸ '
LISTS = ('bulleted_list_item', 'numbered_list_item')
HEADINGS = {'heading_1': '#', 'heading_2': '##', 'heading_3': '###'}

# ---------- inline: rich text ↔ Markdown ----------

INLINE = re.compile(r'\\(.)|`([^`]*)`|\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]*)\]\(([^)\s]*)\)', re.S)


def _runs(text, marks=frozenset(), link=None):
    """[(content, marks, link)] of a line of Markdown text."""
    out, at = [], 0
    for found in INLINE.finditer(text):
        if found.start() > at:
            out.append((text[at:found.start()], marks, link))
        escaped, code, bold, italic, label, url = found.groups()
        if escaped is not None:
            out.append((escaped, marks, link))
        elif code is not None:
            out.append((code, marks | {'code'}, link))
        elif bold is not None:
            out += _runs(bold, marks | {'bold'}, link)
        elif italic is not None:
            out += _runs(italic, marks | {'italic'}, link)
        else:
            out += _runs(label, marks, url)
        at = found.end()
    if at < len(text):
        out.append((text[at:], marks, link))
    return out


def _merged(runs):
    out = []
    for content, marks, link in runs:
        if not content:
            continue
        if out and out[-1][1] == marks and out[-1][2] == link:
            out[-1] = (out[-1][0] + content, marks, link)
        else:
            out.append((content, marks, link))
    return out


def rich_text(text):
    """Markdown text → Notion rich text (parts of at most PART characters; all of them, the caller cuts at PARTS)."""
    parts = []
    for content, marks, link in _merged(_runs(text)) or [('', frozenset(), None)]:
        for i in range(0, max(len(content), 1), PART):
            part = {'type': 'text', 'text': {'content': content[i:i + PART], **({'link': {'url': link}} if link else {})}}
            if marks:
                part['annotations'] = {mark: True for mark in sorted(marks)}
            parts.append(part)
    return parts


def _escape(text):
    return re.sub(r'([\\*`])', r'\\\1', text).replace('[', '\\[')


def _content(part):
    return (part.get('text') or {}).get('content', part.get('plain_text', ''))


def markdown_text(parts):
    """Notion rich text → Markdown text (formatting kept, special characters escaped)."""
    runs = []
    for part in parts or []:
        notes = part.get('annotations') or {}
        link = ((part.get('text') or {}).get('link') or {}).get('url') or part.get('href')
        runs.append((_content(part), frozenset(m for m in ('bold', 'italic', 'code') if notes.get(m)), link))
    out = []
    for content, marks, link in _merged(runs):
        text = content if 'code' in marks else _escape(content)
        if 'code' in marks:
            text = f'`{text}`'
        if 'italic' in marks:
            text = f'*{text}*'
        if 'bold' in marks:
            text = f'**{text}**'
        out.append(f'[{text}]({link})' if link else text)
    return ''.join(out)


def plain_text(parts):
    return ''.join(_content(part) for part in parts or [])


# ---------- blocks → Markdown ----------

def _guard(line):
    """A line of text that Markdown would read as a heading, list, quote, fence or toggle gets a backslash."""
    if re.match(r'(#{1,3} |[-*] |> |```|▸ |---$|\s)', line):
        return '\\' + line
    return re.sub(r'^(\d+)\. ', r'\1\\. ', line)


def _lines(text):
    return [_guard(line) for line in text.split('\n')]


def _kids(block, children):
    inside = block.get('children') or (block.get(block['type']) or {}).get('children')
    if inside is None and block.get('has_children') and children and block.get('id'):
        inside = children(block['id'])
    return inside or []


def to_markdown(blocks, children=None):
    """Notion blocks → Markdown. children(block_id) -> [block] reads a block's children when the block only says it has them."""
    out, number, previous = [], 0, None
    for block in blocks or []:
        kind = block.get('type')
        body = block.get(kind) or {}
        text = markdown_text(body.get('rich_text'))
        number = number + 1 if kind == 'numbered_list_item' and previous == kind else 1
        if kind in HEADINGS:
            toggle = TOGGLE if body.get('is_toggleable') else '\\' if text.startswith(TOGGLE) else ''
            lines = [f"{HEADINGS[kind]} {toggle}{text}"]
        elif kind == 'code':
            language = '' if body.get('language') in (None, 'plain text') else body['language']
            lines = [f'```{language}', *plain_text(body.get('rich_text')).split('\n'), '```']
        elif kind == 'bulleted_list_item':
            first, *rest = _lines(text)
            lines = [f'- {first}', *rest]
        elif kind == 'numbered_list_item':
            first, *rest = _lines(text)
            lines = [f'{number}. {first}', *rest]
        elif kind == 'quote':
            lines = [f'> {line}' for line in text.split('\n')]
        elif kind == 'divider':
            lines = ['---']
        elif 'rich_text' in body:  # paragraphs, and what has no Markdown of its own (callout, to-do): its text
            lines = _lines(text)
        else:
            continue
        inside = to_markdown(_kids(block, children), children)
        if inside:
            lines += ['  ' + line if line else '' for line in inside.split('\n')]
        if out:
            out.append('\n' if kind in LISTS and previous == kind else '\n\n')
        out.append('\n'.join(lines))
        previous = kind
    return ''.join(out)


# ---------- Markdown → blocks ----------

def _block(kind, text, **extra):
    parts = rich_text(text)
    return [{'object': 'block', 'type': kind, kind: {'rich_text': parts[i:i + PARTS], **extra}}
            for i in range(0, len(parts), PARTS)]


def _code(lines, language):
    parts = []
    content = '\n'.join(lines)
    for i in range(0, max(len(content), 1), PART):
        parts.append({'type': 'text', 'text': {'content': content[i:i + PART]}})
    return [{'object': 'block', 'type': 'code', 'code': {'rich_text': parts[i:i + PARTS], 'language': language or 'plain text'}}
            for i in range(0, len(parts), PARTS)]


def _starts_block(line):
    return bool(re.match(r'(#{1,3} |- |\d+\. |> |```|---$)', line))


def to_blocks(markdown):
    """Markdown → Notion blocks (children inline, ready for `children` in a create or append call)."""
    lines = (markdown or '').split('\n')
    blocks, i = [], 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        fence = re.match(r'```(.*)$', line)
        if fence:
            end = next((j for j in range(i + 1, len(lines)) if lines[j].rstrip() == '```'), len(lines))
            blocks += _code(lines[i + 1:end], fence.group(1).strip())
            i = end + 1
            continue
        heading = re.match(r'(#{1,3}) (▸ )?(.*)$', line)
        number = re.match(r'\d+\. (.*)$', line)
        if heading:
            kind = {1: 'heading_1', 2: 'heading_2', 3: 'heading_3'}[len(heading.group(1))]
            made = _block(kind, heading.group(3), **({'is_toggleable': True} if heading.group(2) else {}))
            i += 1
        elif line == '---':
            made, i = [{'object': 'block', 'type': 'divider', 'divider': {}}], i + 1
        elif line.startswith('> '):
            quoted = []
            while i < len(lines) and lines[i].startswith('> '):
                quoted.append(lines[i][2:])
                i += 1
            made = _block('quote', '\n'.join(quoted))
        else:
            kind, text = ('bulleted_list_item', line[2:]) if line.startswith('- ') else \
                ('numbered_list_item', number.group(1)) if number else ('paragraph', line)
            text, i = [text], i + 1
            while i < len(lines) and lines[i].strip() and not lines[i].startswith('  ') and not _starts_block(lines[i]):
                text.append(lines[i])
                i += 1
            made = _block(kind, '\n'.join(text))
        inside = []
        while i < len(lines) and (lines[i].startswith('  ') or (not lines[i].strip() and i + 1 < len(lines)
                                                                 and lines[i + 1].startswith('  '))):
            inside.append(lines[i][2:])
            i += 1
        if inside:
            made[-1][made[-1]['type']]['children'] = to_blocks('\n'.join(inside))
        blocks += made
    return blocks


# ---------- columns: a record's value ↔ a Notion property (plain text, never Markdown) ----------

def value(prop, kind):
    if kind == 'number':
        return (prop or {}).get('number')
    if kind in ('title', 'text'):
        return plain_text((prop or {}).get('title' if kind == 'title' else 'rich_text'))
    if kind == 'checkbox':
        return bool((prop or {}).get('checkbox'))
    from ..notion.ledger import plain
    return plain(prop) or ''


def _plain_parts(text):
    """A column's text as rich text, as written (a column is plain text, not Markdown)."""
    return [{'type': 'text', 'text': {'content': text[i:i + PART]}}
            for i in range(0, len(text), PART)][:PARTS]


def column(kind, raw):
    """A record value as a Notion property."""
    if kind == 'title':
        return {'title': _plain_parts(str(raw or ''))}
    if kind == 'text':
        return {'rich_text': _plain_parts(str(raw or ''))}
    if kind == 'select':
        return {'select': {'name': str(raw)} if raw else None}
    if kind == 'date':
        return {'date': {'start': raw} if raw else None}
    if kind == 'checkbox':
        return {'checkbox': bool(raw)}
    return {'number': raw if raw not in ('', None) else None}
