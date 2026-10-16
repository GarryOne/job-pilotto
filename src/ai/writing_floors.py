"""Code floors under the written text (structure, not meaning): a job that rules the person out gets no letter, a letter carries no salary figure, and a sentence with a figure the profile, the answers and the posting never state is left out.
Used by kit.draft; guarded by tests/test_writing_floors.py. Whether a text is good is the judge's call (tools/free-ai-writing-judge.mjs), never decided here."""
import re

FIGURE = re.compile(r'\d[\d.,\']*\s?(?:%|k\b|K\b|m\b|M\b)?')


def figures(text):
    """The numbers in a text as bare digit strings ('60%' -> '60', 'CHF 130,000' -> '130000'); a single digit is a word-sized count, not a claim."""
    found = []
    for match in FIGURE.finditer(text or ''):
        digits = re.sub(r'\D', '', match.group())
        if len(digits) >= 2:
            found.append(digits.lstrip('0') or '0')
    return found


def unsupported_figures(text, ground):
    """Figures in `text` that appear nowhere in `ground` (the facts the writer was given), in order, once each."""
    known = set(figures(ground))
    known |= {str(int(f) * 1000) for f in known if int(f) < 1000}   # 130k is 130,000
    known |= {str(int(f) // 1000) for f in known if int(f) >= 1000 and int(f) % 1000 == 0}
    seen, out = set(), []
    for number in figures(text):
        if number not in known and number not in seen:
            seen.add(number)
            out.append(number)
    return out


SENTENCE_END = re.compile(r'(?<=[.!?])\s+')
CURRENCY = re.compile(r"(?:CHF|EUR|USD|GBP|€|\$|£)\s?\d|\d[\d.,']*\s?[kK]?\s?(?:CHF|EUR|USD|GBP|€|\$|£)")


def _keep(text, ground, also_drop=None):
    """`text` without the sentences whose figures nothing given supports (and, when `also_drop` is a pattern, the sentences it matches); line breaks stay."""
    lines = []
    for line in text.split('\n'):
        kept = [s for s in SENTENCE_END.split(line) if s.strip() and not unsupported_figures(s, ground) and not (also_drop and also_drop.search(s))]
        lines.append(' '.join(kept))
    return '\n'.join(lines).strip() if any(lines) else ''


def scrub(value, ground):
    """A drafted structure (dicts, lists, strings) with every sentence dropped that states a figure the profile, the answers and the posting never state; a list item left empty goes too. Returns (value, dropped count)."""
    dropped = [0]

    def walk(item):
        if isinstance(item, str):
            kept = _keep(item, ground)
            if item.strip() and kept != item.strip():
                dropped[0] += 1
            return kept
        if isinstance(item, list):
            return [x for x in (walk(each) for each in item) if x not in ('', None)]
        if isinstance(item, dict):
            return {key: walk(each) for key, each in item.items()}
        return item
    return walk(value), dropped[0]


NOT_A_MATCH = 'Not a match: '


def kit_floors(kit, ground):
    """Applies the floors to a drafted kit (a dict as kit.SCHEMA); returns the kit, changed in place.
    No match: no letter and no drafted free text. Otherwise: no salary figure in the letter (the form asks for it), and no sentence with a figure nothing given supports."""
    checks = kit.setdefault('check_before_sending', [])
    if kit.get('eligible') is False:
        why = (kit.get('eligibility_note') or '').strip().rstrip('.') or 'the posting rules you out'
        why = why[len(NOT_A_MATCH):] if why.startswith(NOT_A_MATCH) else why
        kit['eligibility_note'] = f'{NOT_A_MATCH}{why}.'
        kit['cover_letter'] = ''
        for item in kit.get('answers') or []:
            if item.get('category') == 'normal':
                item['answer'], item['needs_review'] = '', True
        return kit
    letter = _keep(kit.get('cover_letter') or '', ground, also_drop=CURRENCY)
    removed = (kit.get('cover_letter') or '').strip() != letter
    kit['cover_letter'] = letter
    for item in kit.get('answers') or []:
        answer = _keep(item.get('answer') or '', ground)
        if answer != (item.get('answer') or '').strip():
            item['answer'], item['needs_review'], removed = answer, True, True
    if removed:
        checks.append('Sentences with a figure or salary your profile, answers and the posting do not state were left out: read the letter once.')
    return kit
