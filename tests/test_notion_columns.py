"""The one place that leaves out a column a Notion workspace lacks: the schema pre-read and the retry on refusal."""
import unittest

from src.stores.notion_columns import KnownColumns, without_missing


class FakeTracker:
    def __init__(self, columns):
        self.columns, self.reads = columns, 0

    def _request(self, method, path, body=None):
        self.reads += 1
        return {'properties': {name: {} for name in self.columns}}


class KnownColumnsTest(unittest.TestCase):
    def test_keeps_only_existing_columns_and_reads_the_schema_once(self):
        tracker = FakeTracker(['Name', 'Kind'])
        known = KnownColumns(tracker, 'db1')
        self.assertEqual(known.writable({'Name': 1, 'Where': 2, 'Kind': 3}), {'Name': 1, 'Kind': 3})
        known.writable({'Name': 1})
        self.assertEqual(tracker.reads, 1)


class WithoutMissingTest(unittest.TestCase):
    def test_drops_the_refused_column_and_sends_again(self):
        sent = []

        def send(props):
            sent.append(dict(props))
            if 'Where' in props:
                raise RuntimeError('Where is not a property that exists.')
            return 'ok'

        self.assertEqual(without_missing(send, {'Name': 1, 'Where': 2}), 'ok')
        self.assertEqual(sent, [{'Name': 1, 'Where': 2}, {'Name': 1}])

    def test_other_errors_are_raised(self):
        def send(props):
            raise RuntimeError('rate limited')
        with self.assertRaises(RuntimeError):
            without_missing(send, {'Name': 1})


if __name__ == '__main__':
    unittest.main()
