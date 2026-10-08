"""Interview analysis, replacing a review on an Interviews page: finding the blocks an earlier review wrote and swapping them.
Re-exported by src/ai/interviews.py. Tests: tests/test_interviews_again.py.
"""
from ..notion.ledger import plain


# The headings analysis_blocks() writes: how an earlier review is found on the page to be replaced.
REVIEW_HEADINGS = ('Strengths', 'Weak spots', 'Signals from them', 'Could count against you', 'Facts from the call',
                   'Practise before the next round', 'Questions')


def _plain_block(block):
    return plain({'type': 'rich_text', 'rich_text': block.get(block['type'], {}).get('rich_text', [])}) or ''


def review_block_ids(blocks):
    """The blocks of the review(s) on an interview page: each review's summary (the paragraph right before its first
    heading), its headings and their bullets. The job line, the Transcript toggle and anything else stay."""
    ids, inside = [], False
    for i, block in enumerate(blocks):
        kind = block['type']
        if kind == 'heading_3' and not block[kind].get('is_toggleable') and _plain_block(block) in REVIEW_HEADINGS:
            before = blocks[i - 1] if i else None
            if not inside and before and before['type'] == 'paragraph' and before['id'] not in ids \
                    and not _plain_block(before).startswith('🔗 ') and _plain_block(before) != PLACEHOLDER:
                ids.append(before['id'])
            ids.append(block['id'])
            inside = True
        elif inside and kind == 'bulleted_list_item':
            ids.append(block['id'])
        else:
            inside = False
    return ids


def replace_review(tracker, page_id, blocks):
    """Put a new review where the old one is: added right after it, then the old blocks removed (a failed add leaves
    the old review whole; a second run also clears what a half-done delete left). No review yet: add_review."""
    old = review_block_ids(tracker._children(page_id))
    if not old:
        return add_review(tracker, page_id, blocks)
    tracker._request('PATCH', f'blocks/{page_id}/children', {'children': blocks, 'after': old[-1]})
    for block_id in old:
        tracker._request('DELETE', f'blocks/{block_id}')


PLACEHOLDER = 'Not reviewed yet. Review it from the Interviews page of the Job Pilotto app.'


def add_review(tracker, page_id, blocks):
    """Put the review where the placeholder is (the top of the page), or at the end if it's gone."""
    marker = next((b for b in tracker._children(page_id) if b['type'] == 'paragraph' and
                   plain({'type': 'rich_text', 'rich_text': b['paragraph'].get('rich_text', [])}) == PLACEHOLDER), None)
    tracker._request('PATCH', f'blocks/{page_id}/children', {'children': blocks, **({'after': marker['id']} if marker else {})})
    if marker:
        tracker._request('DELETE', f"blocks/{marker['id']}")
