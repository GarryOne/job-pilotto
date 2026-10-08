#!/usr/bin/env python3
"""Notion property and block helpers of the application ledger: reading a property as a plain value, rich text,
markdown to Notion blocks, answer-key normalising, day parsing. Owned by src/notion/ledger.py (re-exported there).

Guarded by tests/test_ledger.py."""
import re
from datetime import date


def plain(prop):
    """A Notion property value as a plain Python value."""
    if not prop:
        return None
    kind = prop.get('type') or next((k for k in ('title', 'rich_text', 'select', 'multi_select', 'number',
                                                 'checkbox', 'url', 'date') if k in prop), None)
    value = prop.get(kind)
    if kind in ('title', 'rich_text'):
        return ''.join(t.get('plain_text', '') for t in value or [])
    if kind == 'select':
        return (value or {}).get('name')
    if kind == 'multi_select':
        return [item['name'] for item in value or []]
    if kind == 'date':
        return (value or {}).get('start')
    return value


def _text(value):
    return {'rich_text': [{'text': {'content': str(value)[:2000]}}] if value else []}


def _chunks(content, size=1900):
    return [content[i:i + size] for i in range(0, len(content), size)] or ['']


def _block(kind, content, bold=False):
    return {'object': 'block', 'type': kind,
            kind: {'rich_text': [{'type': 'text', 'text': {'content': c}, 'annotations': {'bold': bold}}
                                 for c in _chunks(content)[:100]]}}


def _rich(text):
    """Inline Markdown (**bold**, *italic*, `code`) as Notion rich text."""
    parts, runs = re.split(r'(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)', text or ''), []
    for part in parts:
        if not part:
            continue
        bold, italic, code = part.startswith('**'), part.startswith('*') and not part.startswith('**'), part.startswith('`')
        content = part.strip('*`') if (bold or italic or code) else part
        for chunk in _chunks(content):
            runs.append({'type': 'text', 'text': {'content': chunk}, 'annotations': {'bold': bold, 'italic': italic, 'code': code}})
    return runs[:100] or [{'type': 'text', 'text': {'content': ''}}]


def _typed(kind, text):
    return {'object': 'block', 'type': kind, kind: {'rich_text': _rich(text)}}


def md_blocks(text, limit=90):
    """Markdown as Notion blocks: headings, bulleted and numbered lists, bold/italic inline, paragraphs. AI answers
    come as Markdown; written as plain paragraphs they showed "# Role Details" and "**Position:**" on the page."""
    blocks, paragraph = [], []

    def flush():
        if paragraph:
            blocks.append(_typed('paragraph', ' '.join(paragraph)))
            paragraph.clear()
    for line in (text or '').splitlines():
        stripped = line.strip()
        heading = re.match(r'^(#{1,6})\s+(.*)$', stripped)
        bullet = re.match(r'^[-*•]\s+(.*)$', stripped)
        number = re.match(r'^\d+[.)]\s+(.*)$', stripped)
        if not stripped or re.fullmatch(r'[-*_]{3,}', stripped):
            flush()
        elif heading:
            flush()
            blocks.append(_typed('heading_3', heading.group(2).strip('*')))
        elif bullet or number:
            flush()
            kind = 'bulleted_list_item' if bullet else 'numbered_list_item'
            blocks.append(_typed(kind, (bullet or number).group(1)))
        elif label := re.fullmatch(r'\*\*([^*]+?):?\*\*:?', stripped):  # "**Tech Stack:**" alone: the list below's heading
            flush()
            blocks.append(_typed('heading_3', label.group(1)))
        elif re.match(r'^\*\*[^*]+:\*\*|^\*\*[^*]+\*\*:', stripped):  # "**Position:** Principal SRE": a fact, one bullet each
            flush()
            blocks.append(_typed('bulleted_list_item', stripped))
        else:
            paragraph.append(stripped)
            flush()  # one line, one paragraph: AI answers break lines on purpose
    flush()
    return blocks[:limit]


def _key(text):
    return re.sub(r'[^a-z0-9]+', ' ', (text or '').lower()).strip()


def _day(value):
    try:
        return date.fromisoformat((value or '')[:10])
    except ValueError:
        return None
