"""Interview analysis, a review on a Notion Interviews page: the blocks an earlier review wrote (found by its headings) and the
placeholder; src/stores/notion_interviews.py swaps them. Re-exported by src/ai/interviews.py. Tests: tests/test_interviews_again.py.
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


PLACEHOLDER = 'Not reviewed yet. Review it from the Interviews page of the Job Pilotto app.'
