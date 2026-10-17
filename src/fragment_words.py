"""A crawl match pattern as the words a person reads: the Python twin of desktop/renderer/fragment-words.js (same rule, same cases).

Owner, 17 Oct 2026: "the person never sees a pattern" (Strategy showed "Tax", "SRE" with quotes and raw place patterns).
\\bz[uü]rich\\b -> zürich, "zug" -> zug, st\\.? ?gallen -> st. gallen, a|b -> a / b. Display only: the patterns are kept as stored.
Guarded by tests/test_fragment_words.py (the cases of desktop/test/fragment-words.test.js).
"""
import re


def _alternatives(text):
    parts, depth, start, i = [], 0, 0, 0
    while i < len(text):
        char = text[i]
        if char == '\\':
            i += 2
            continue
        if char in '([':
            depth += 1
        elif char in ')]' and depth > 0:
            depth -= 1
        elif char == '|' and depth == 0:
            parts.append(text[start:i])
            start = i + 1
        i += 1
    return parts + [text[start:]]


def _unwrap(text):
    """A pattern that is one group as a whole (\\b(?:zug|luzern)\\b) is read as that group's alternatives."""
    inner = re.sub(r'^\\b(.*)\\b$', r'\1', text)
    if not (inner.startswith('(') and inner.endswith(')')):
        return text
    depth, i = 0, 0
    while i < len(inner):
        if inner[i] == '\\':
            i += 2
            continue
        if inner[i] == '(':
            depth += 1
        elif inner[i] == ')':
            depth -= 1
            if depth == 0 and i < len(inner) - 1:
                return text
        i += 1
    return re.sub(r'^\?:', '', inner[1:-1])


def _plain(part):
    text = re.sub(r'^"(.*)"$', r'\1', part)
    text = text.replace('\\b', '').replace('(?:', '(')
    text = re.sub(r'\([^()]*\)\?', '', text)               # (an optional group)? -> left out
    text = re.sub(r'\(([^()|]*)\|[^()]*\)', r'\1', text)   # (a|b) -> a
    text = re.sub(r'\[[^\]]*?([^\]])\]', r'\1', text)      # a letter choice: its last letter
    text = re.sub(r'\\(.)', r'\1', text)                   # \. -> .
    text = re.sub(r'[?*+()^$|{}\[\]"]', '', text)
    text = re.sub(r'(^|\s)\.(?=\s|$)', r'\1', text)
    text = re.sub(r'\.$', '', text)
    return re.sub(r'\s+', ' ', text).strip()


def fragment_names(fragment):
    """pattern -> the names (or words) it matches, in order, no repeats."""
    text = _unwrap(re.sub(r'^"(.*)"$', r'\1', str(fragment or '').strip()))
    return list(dict.fromkeys(name for name in (_plain(part) for part in _alternatives(text)) if name))


def fragment_words(fragment):
    """pattern -> one line of words ("deutschland / germany")."""
    return ' / '.join(fragment_names(fragment))
