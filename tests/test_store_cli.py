"""python -m src.stores call: the desktop's one way into the active store."""
import io
import json
import os
import unittest
from unittest import mock

from src.stores import __main__ as cli
from src.stores import memory


class StoreCliTests(unittest.TestCase):
    def run_cli(self, *argv, stores=None):
        out = io.StringIO()
        with mock.patch.object(cli, 'open_stores', return_value=stores or memory.open_store()), \
                mock.patch.dict(os.environ, {'JOB_PILOTTO_STORE': 'memory'}):
            code = cli.main(list(argv), out=out)
        return code, json.loads(out.getvalue())

    def test_a_method_runs_on_the_active_store_and_answers_json(self):
        stores = memory.open_store()
        code, answer = self.run_cli('call', 'applications', 'set_stage',
                                    json.dumps({'job': {'url': 'https://x.example/1'}, 'stage': 'Saved'}), stores=stores)
        self.assertEqual((code, answer['result'][1]), (0, 'created'))
        code, answer = self.run_cli('call', 'applications', 'stages', stores=stores)
        self.assertEqual(answer['result'], {'https://x.example/1': 'Saved'})

    def test_moves_bytes_private_and_unknown_methods_are_refused(self):
        for entity, method in (('applications', 'put'), ('applications', 'files'), ('applications', 'attach'),
                               ('applications', '_get'), ('applications', 'rows'), ('nosuch', 'list')):
            code, answer = self.run_cli('call', entity, method)
            self.assertEqual(code, 2, f'{entity}.{method}')
            self.assertIn('not callable', answer['error'])

    def test_an_error_in_the_method_is_said_not_swallowed(self):
        code, answer = self.run_cli('call', 'applications', 'update', json.dumps({'app_id': 'missing', 'fields': {}}))
        self.assertEqual(code, 1)
        self.assertIn('KeyError', answer['error'])


if __name__ == '__main__':
    unittest.main()
