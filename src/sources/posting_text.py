"""A posting's HTML as readable text that keeps its shape: headings, paragraphs and list items stay on their own lines, so the app can show
"Responsibilities" with its bullets (renderer/job-drawer/tab-description.js). 10 Oct 2026: both fetchers squashed every posting into one
line, and 138 of 139 saved descriptions were one block of text. Structure only (the HTML's own block tags), never a word list.
Markers the readers share: "## Heading" on a line of its own, "- item" for a list item, a blank line between paragraphs.
Guarded by tests/test_posting_text.py."""
import html
import re

LIMIT = 12000
_HEADING = re.compile(r'<\s*h[1-6]\b[^>]*>(.*?)<\s*/\s*h[1-6]\s*>', re.S | re.I)
# A paragraph that is only bold text, short, is a heading in all but name ("<p><strong>Requirements</strong></p>").
_BOLD_ONLY = re.compile(r'<\s*(p|div)\b[^>]*>\s*<\s*(strong|b)\b[^>]*>([^<]{1,80})<\s*/\s*\2\s*>\s*:?\s*<\s*/\s*\1\s*>', re.I)
_ITEM = re.compile(r'<\s*li\b[^>]*>', re.I)
_BREAK = re.compile(r'<\s*/?\s*(?:p|div|section|article|header|footer|ul|ol|table|tr|br|hr|blockquote)\b[^>]*>', re.I)
_TAG = re.compile(r'<[^>]+>')


def _clean(fragment):
    return re.sub(r'\s+', ' ', _TAG.sub(' ', fragment)).strip()


def html_to_text(markup, limit=LIMIT):
    """HTML (possibly escaped twice) to text with its structure; text without tags comes back as it was, tidied."""
    text = html.unescape(html.unescape(markup or ''))
    text = _HEADING.sub(lambda found: f'\n\n## {_clean(found[1]).rstrip(":").strip()}\n', text)
    text = _BOLD_ONLY.sub(lambda found: f'\n\n## {found[3].strip().rstrip(":").strip()}\n', text)
    text = _ITEM.sub('\n- ', text)
    text = _BREAK.sub('\n', text)
    text = html.unescape(_TAG.sub(' ', text))
    lines = [re.sub(r'[ \t\r\f\v ]+', ' ', line).strip() for line in text.split('\n')]
    out = []
    for line in lines:
        if line == '-':   # an empty list item
            continue
        if not line and (not out or not out[-1] or out[-1].startswith('## ')):
            continue   # one blank line at most, none at the start or straight after a heading
        out.append(line)
    return '\n'.join(out).strip()[:limit]
