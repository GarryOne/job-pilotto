"""💡 Insights in Notion as store records (src/stores/notion_insights.py): the contract's insight behaviour against an
in-memory Notion, extras as columns, the body as blocks, and a column an older workspace lacks dropped, never the row."""
import unittest

from src.stores import base, notion_blocks
from src.stores.notion_insights import NotionInsights


class MemoryNotion:
    """Rows of one database with page bodies; `missing` names columns this workspace doesn't have."""

    def __init__(self, missing=()):
        self.pages, self.blocks, self.missing, self.count = {}, {}, set(missing), 0

    def query_database(self, database_id, filter_=None):
        return [dict(p) for p in self.pages.values()]

    def _check(self, props):
        for name in props:
            if name in self.missing:
                raise RuntimeError(f'{name} is not a property that exists.')

    def _request(self, method, path, body=None):
        if method == 'POST' and path == 'pages':
            self._check(body['properties'])
            self.count += 1
            page = {'id': f'ins-{self.count}', 'created_time': f'2026-10-09T10:00:0{self.count}Z', 'properties': dict(body['properties'])}
            self.pages[page['id']] = page
            self.blocks[page['id']] = [dict(b, id=f"{page['id']}-c{i}") for i, b in enumerate(body.get('children', []))]
            return dict(page)
        page_id = path.split('/')[1]
        if method == 'GET':
            if page_id not in self.pages:
                raise RuntimeError('Could not find page')
            return dict(self.pages[page_id])
        if method == 'PATCH' and path.startswith('pages/'):
            self._check(body['properties'])
            self.pages[page_id]['properties'].update(body['properties'])
            return dict(self.pages[page_id])
        if method == 'PATCH' and path.endswith('/children'):
            self.blocks[page_id] += [dict(b, id=f'{page_id}-b{len(self.blocks[page_id])}') for b in body['children']]
            return {}
        if method == 'DELETE':
            for blocks in self.blocks.values():
                blocks[:] = [b for b in blocks if b.get('id') != page_id]
            return {}
        raise AssertionError(f'unexpected {method} {path}')

    def _children(self, page_id):
        return [dict(b) for b in self.blocks.get(page_id, [])]

    def append_blocks(self, page_id, blocks):
        return self._request('PATCH', f'blocks/{page_id}/children', {'children': blocks})


class NotionInsightsTests(unittest.TestCase):
    def setUp(self):
        self.notion = MemoryNotion()
        self.s = NotionInsights(self.notion, database_id='insights-db')

    def test_rows_of_their_own_share_a_day_and_update_in_place(self):
        one = self.s.add({'day': '2026-10-08', 'category': 'Process', 'title': 'A', 'fields': {'sample_size': 4}})
        self.assertEqual(set(one), set(base.INSIGHT_FIELDS))
        self.s.add({'day': '2026-10-08', 'category': 'Process', 'title': 'B'})
        self.assertEqual(sorted(i['title'] for i in self.s.list(category='Process')), ['A', 'B'])
        kept = self.s.update(one['id'], {'title': 'A2', 'fields': {'sample_size': 5}})
        self.assertEqual((kept['id'], kept['title'], kept['fields']), (one['id'], 'A2', {'sample_size': 5}))
        with self.assertRaises(KeyError):
            self.s.update('missing', {'title': 'x'})

    def test_save_keeps_one_per_day_and_category_newest_first(self):
        self.s.save('2026-10-07', 'daily', 'Old', 'a')
        self.s.save('2026-10-08', 'daily', 'New', 'b')
        again = self.s.save('2026-10-08', 'daily', 'Newer', 'c', {'confidence': 'high'})
        self.assertEqual(again['fields'], {'confidence': 'high'})
        self.assertEqual([i['title'] for i in self.s.list(category='daily')], ['Newer', 'Old'])
        self.assertEqual([i['title'] for i in self.s.list(since='2026-10-08')], ['Newer'])
        self.assertEqual(len(self.s.list(limit=1)), 1)

    def test_extras_are_their_columns_and_unknown_ones_refused(self):
        row = self.s.add({'day': '2026-10-08', 'category': 'Interview patterns', 'title': 'Patterns', 'fields': {
            'basis': 'Interviews', 'evidence': 'Two *calls*', 'issue_detected': True, 'data': '{"v": 3}', 'cost': 0.012}})
        props = self.notion.pages[row['id']]['properties']
        self.assertEqual((props['Basis'], props['Issue detected'], props['Cost (USD)']),
                         ({'select': {'name': 'Interviews'}}, {'checkbox': True}, {'number': 0.012}))
        self.assertEqual(self.s.list()[0]['fields']['evidence'], 'Two *calls*')
        with self.assertRaises(KeyError):
            self.s.add({'day': '2026-10-08', 'category': 'x', 'title': 'y', 'fields': {'colour': 'red'}})

    def test_the_body_is_the_page_written_from_markdown_and_replaced_whole(self):
        row = self.s.add({'day': '2026-10-08', 'category': 'Weekly', 'title': 'Week', 'body': '## Focus\n\n- one\n- two'})
        self.assertEqual([b['type'] for b in self.notion.blocks[row['id']]], ['heading_2', 'bulleted_list_item', 'bulleted_list_item'])
        self.s.update(row['id'], {'body': 'Just this.'})
        self.assertEqual(notion_blocks.to_markdown(self.notion._children(row['id'])), 'Just this.')

    def test_a_column_the_workspace_lacks_is_dropped_never_the_row(self):
        s = NotionInsights(MemoryNotion(missing={'Input hash'}), database_id='insights-db')
        row = s.add({'day': '2026-10-08', 'category': 'Interview patterns', 'title': 'P', 'fields': {'input_hash': 'abc', 'model': 'm'}})
        self.assertEqual(s.list()[0]['fields'], {'model': 'm'})
        self.assertEqual(row['title'], 'P')


if __name__ == '__main__':
    unittest.main()
