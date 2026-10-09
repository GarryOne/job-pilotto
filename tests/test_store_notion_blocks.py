"""The Markdown ↔ Notion blocks codec (src/stores/notion_blocks.py): Markdown round trips, text read from Notion kept as
written, and today's interview page (review + transcript toggle) coming back as the same blocks."""
import unittest

from src.ai import interviews_blocks
from src.stores import notion_blocks as nb
from tests.interviews_fixtures import RESULT, SPOKEN

MARKDOWN = """# Kit

Dear **Acme**, I *really* want `kubectl` and [the docs](https://acme.example/docs).
A second line of the same paragraph.

## Questions

- Why Acme?
- Notice period
  - Three months
  - Negotiable

1. First
2. Second

```python
print("hi")
  indented
```

> Quoted line
> and another

---

### ▸ Prep
  Body of the toggle.

  - with a list"""


def runs(blocks):
    """What Notion shows: each block's type, toggle flag, text runs (content, marks, link) merged across parts, and children."""
    out = []
    for block in blocks:
        body = block[block['type']]
        merged = []
        for part in body.get('rich_text', []):
            run = (frozenset(k for k, v in (part.get('annotations') or {}).items() if v),
                   ((part.get('text') or {}).get('link') or {}).get('url'))
            if merged and merged[-1][1:] == run:
                merged[-1] = (merged[-1][0] + nb._content(part), *run)
            else:
                merged.append((nb._content(part), *run))
        out.append((block['type'], bool(body.get('is_toggleable')), body.get('language'), merged,
                    runs(body.get('children') or [])))
    return out


class CodecTests(unittest.TestCase):
    def test_markdown_round_trips(self):
        self.assertEqual(nb.to_markdown(nb.to_blocks(MARKDOWN)), MARKDOWN)

    def test_the_shapes_are_notions(self):
        kinds = [b['type'] for b in nb.to_blocks(MARKDOWN)]
        self.assertEqual(kinds, ['heading_1', 'paragraph', 'heading_2', 'bulleted_list_item', 'bulleted_list_item',
                                 'numbered_list_item', 'numbered_list_item', 'code', 'quote', 'divider', 'heading_3'])
        blocks = nb.to_blocks(MARKDOWN)
        toggle = blocks[-1]['heading_3']
        self.assertTrue(toggle['is_toggleable'])
        self.assertEqual([b['type'] for b in toggle['children']], ['paragraph', 'bulleted_list_item'])
        self.assertEqual([b['type'] for b in blocks[4]['bulleted_list_item']['children']], ['bulleted_list_item'] * 2)
        para = blocks[1]['paragraph']['rich_text']
        self.assertEqual([(p['text']['content'], sorted(p.get('annotations', {}))) for p in para][:4],
                         [('Dear ', []), ('Acme', ['bold']), (', I ', []), ('really', ['italic'])])
        self.assertEqual(blocks[7]['code']['language'], 'python')

    def test_text_that_looks_like_markdown_comes_back_as_written(self):
        tricky = ['# not a heading', '- not a list', '1. not a list', '> not a quote', '```', '---', '▸ not a toggle',
                  'stars *x* and `ticks` and [x](y) and back\\slash', '  leading spaces', 'a\n- b\n  c']
        for text in tricky:
            blocks = [{'type': 'paragraph', 'paragraph': {'rich_text': [{'type': 'text', 'text': {'content': text}}]}}]
            self.assertEqual(runs(nb.to_blocks(nb.to_markdown(blocks))), runs(blocks), text)
        heading = [{'type': 'heading_2', 'heading_2': {'rich_text': [{'type': 'text', 'text': {'content': '▸ arrow'}}]}}]
        self.assertEqual(runs(nb.to_blocks(nb.to_markdown(heading))), runs(heading))

    def test_long_text_is_cut_into_parts_and_blocks(self):
        blocks = nb.to_blocks('x' * (nb.PART * nb.PARTS + 5))
        self.assertEqual(len(blocks), 2)
        self.assertEqual(len(blocks[0]['paragraph']['rich_text']), nb.PARTS)
        self.assertTrue(all(len(p['text']['content']) <= 2000 for b in blocks for p in b['paragraph']['rich_text']))

    def test_children_are_read_through_the_callable_when_only_flagged(self):
        toggle = {'id': 't1', 'type': 'heading_2', 'has_children': True,
                  'heading_2': {'is_toggleable': True, 'rich_text': [{'plain_text': 'Kit'}]}}
        child = {'type': 'paragraph', 'paragraph': {'rich_text': [{'plain_text': 'Dear Acme'}]}}
        self.assertEqual(nb.to_markdown([toggle], children=lambda block_id: [child] if block_id == 't1' else []),
                         '## ▸ Kit\n  Dear Acme')

    def test_todays_interview_page_comes_back_as_the_same_blocks(self):
        merged = {'filled': [], 'differs': [], 'changes': {}}
        page = interviews_blocks.page_blocks(RESULT, SPOKEN + '\n' + 'y' * 5000, merged)
        self.assertEqual(runs(nb.to_blocks(nb.to_markdown(page))), runs(page))
        review = interviews_blocks.analysis_blocks(RESULT, merged)
        self.assertEqual(nb.to_markdown(nb.to_blocks(nb.to_markdown(review))), nb.to_markdown(review))


if __name__ == '__main__':
    unittest.main()
