"""One look for every Telegram message Job Pilotto sends (Telegram HTML).

    <emoji> <b>Title</b>            a bold title, one emoji at most
    plain subtitle · counts         what the message is about, plain text with " · "

    <b>Heading</b>                  blocks separated by one blank line: a bold heading,
    plain lines under it            then plain lines; "Label: value" for facts

No italics for content, no emoji per line, no scores in emoji. Build with card()/block().
"""
from html import escape


def block(heading, *lines):
    """A bold heading and plain lines. `heading` and `lines` are already-escaped HTML; empty lines are dropped."""
    return '\n'.join([f'<b>{heading}</b>' if heading else '', *[l for l in lines if l]]).strip('\n')


def fact(label, value):
    """'Label: value' with the label in bold ('' when there is no value)."""
    return f'<b>{escape(label)}:</b> {escape(str(value))}' if value not in (None, '') else ''


def card(title, subtitle='', blocks=(), emoji='', footer=''):
    """title/subtitle are plain text (escaped here); blocks and footer are HTML built with block()."""
    head = f"{emoji + ' ' if emoji else ''}<b>{escape(title)}</b>" + (f'\n{escape(subtitle)}' if subtitle else '')
    return '\n\n'.join([head, *[b for b in blocks if b], *([footer] if footer else [])])


def dot(*parts):
    """Join the non-empty parts with ' · '."""
    return ' · '.join(str(p) for p in parts if p not in (None, ''))
