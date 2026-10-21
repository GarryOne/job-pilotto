"""The one list of target roles (src/target_roles.py): derived keys, the two-lists read, the AI merge, and both homes of the settings (file, Notion page)."""
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import target_roles as t
from src.notion import search_settings as s

OLD = {'role_keywords': ['registered nurse', 'rn', 'staff nurse', 'ward nurse', 'charge nurse', r'\bsister\b', 'clinical nurse'],
       'jobs_board_search_queries': ['Registered Nurse', 'Staff Nurse', 'Charge Nurse', 'Clinical Nurse']}   # demo data, the shape of the owner's two lists


def grouped(items, answers):
    """A stand-in for the AI's fixed answer: rn -> title 0, ward nurse -> 1, sister -> 2 (by title number)."""
    pick = {'rn': '0', 'ward nurse': '1', 'sister': '2'}
    return {key: pick.get(key, 'none') for key in items}


class TargetRolesTests(unittest.TestCase):
    def test_two_lists_read_as_one_by_exact_text_and_lose_nothing(self):
        roles = t.view(OLD)
        self.assertEqual([r['title'] for r in roles], ['Registered Nurse', 'Staff Nurse', 'Charge Nurse', 'Clinical Nurse', 'rn', 'ward nurse', 'sister'])
        keywords, queries = t.derive(roles)
        self.assertEqual(set(keywords), set(OLD['role_keywords']))   # every old keyword still matches
        self.assertEqual(queries, ['Registered Nurse', 'Staff Nurse', 'Charge Nurse', 'Clinical Nurse', 'rn'])   # the first five are searched

    def test_the_ai_folds_short_forms_under_their_title_as_hidden_variants(self):
        done = t.migrate(OLD, ask=grouped)
        self.assertEqual([r['title'] for r in done['target_roles']], ['Registered Nurse', 'Staff Nurse', 'Charge Nurse', 'Clinical Nurse'])
        self.assertEqual(done['target_roles'][0]['also'], ['rn'])
        self.assertEqual(done['target_roles'][2]['also'], [r'\bsister\b'])
        self.assertEqual(set(done['role_keywords']), set(OLD['role_keywords']))
        self.assertEqual(done['jobs_board_search_queries'], OLD['jobs_board_search_queries'])

    def test_no_answer_from_the_ai_changes_nothing_and_is_asked_again(self):
        self.assertIsNone(t.migrate(OLD, ask=lambda items, answers: None))
        self.assertIsNone(t.migrate(OLD, ask=lambda items, answers: {'rn': '0'}))   # a partial answer is no decision
        self.assertTrue(t.unmigrated(OLD))

    def test_nothing_is_asked_when_every_role_is_already_a_search(self):
        search = {'role_keywords': ['registered nurse'], 'jobs_board_search_queries': ['Registered Nurse']}
        done = t.migrate(search, ask=lambda items, answers: self.fail('no AI call is needed'))
        self.assertEqual(done['role_keywords'], ['registered nurse'])

    def test_a_form_that_needs_its_regex_keeps_it(self):
        roles = t.view({'role_keywords': ['intern(ship)?', r'\bsre\b'], 'jobs_board_search_queries': ['Site Reliability Engineer']})
        keywords, _ = t.derive(roles)
        self.assertEqual(set(keywords), {'intern(ship)?', r'\bsre\b', 'site reliability engineer'})

    def test_a_typed_title_matches_job_titles_like_the_old_fragment(self):
        fragment = t.title_fragment('C++ Developer (m/w)')
        self.assertTrue(re.search(fragment, 'Senior C++ Developer (M/W) Zurich', re.I))

    def test_the_engine_reads_the_same_keys_from_a_merged_file(self):
        search = {'target_roles': [{'title': 'Registered Nurse', 'also': ['rn']}, {'title': 'Ward Nurse', 'also': []}]}
        with tempfile.TemporaryDirectory() as tmp, mock.patch('src.paths.CONFIG', Path(tmp)):
            (Path(tmp) / 'search.json').write_text(json.dumps(search))
            config = __import__('src.paths', fromlist=['x']).load_search_config(matching=False)
        self.assertEqual(config['role_keywords'], ['registered nurse', 'rn', 'ward nurse'])
        self.assertEqual(config['jobs_board_search_queries'], ['Registered Nurse', 'Ward Nurse'])

    def test_the_shared_cases_the_desktop_twin_also_runs(self):
        for case in json.loads((Path(__file__).parent / 'fixtures' / 'target_roles_cases.json').read_text()):
            roles = t.view(case['search'])
            keywords, queries = t.derive(roles)
            self.assertEqual(([r['title'] for r in roles], keywords, queries), (case['titles'], case['role_keywords'], case['queries']), case['name'])

    def test_a_file_with_neither_list_is_left_alone(self):
        self.assertEqual(t.with_derived({'locations': {}}), {'locations': {}})


class HomesTests(unittest.TestCase):
    """The settings' two homes: config/search.json (SQLite and Trying users: the file is the home) and the Notion ⚙️ Search settings page (rendered from it)."""

    def files(self, search):
        return {'search': json.loads(json.dumps(search)), 'preferences': {}}

    def test_file_home_the_migration_writes_one_list_and_the_derived_keys(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(s, 'CONFIG', Path(tmp)), \
                mock.patch('src.ai.decide.decide', side_effect=lambda topic, items, answers, instructions, client=None, db=None: grouped(items, answers)):
            (Path(tmp) / 'search.json').write_text(json.dumps(OLD))
            self.assertTrue(t.migrate_quietly())
            saved = json.loads((Path(tmp) / 'search.json').read_text())
            self.assertFalse(t.migrate_quietly())   # once
        self.assertEqual(len(saved['target_roles']), 4)
        self.assertEqual(set(saved['role_keywords']), set(OLD['role_keywords']))

    def test_notion_home_the_page_shows_one_section_with_titles_only(self):
        text = s.render(self.files(t.migrate(OLD, ask=grouped)))
        self.assertIn('## Target roles\n- Registered Nurse\n- Staff Nurse\n- Charge Nurse\n- Clinical Nurse\n', text)
        self.assertNotIn('Roles to look for', text)
        self.assertNotIn('Job board searches', text)

    def test_notion_home_an_edit_on_the_page_keeps_the_variants_of_the_titles_that_stay(self):
        files = self.files(t.migrate(OLD, ask=grouped))
        edited = s.render(files).replace('- Clinical Nurse\n', '- Clinical Nurse\n- Nurse Practitioner\n').replace('- Staff Nurse\n', '')
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(s, 'CONFIG', Path(tmp)):
            for name, data in files.items():
                (Path(tmp) / f'{name}.json').write_text(json.dumps(data))
            saved = s.apply(s.parse(edited))['search']
        self.assertEqual([r['title'] for r in saved['target_roles']], ['Registered Nurse', 'Charge Nurse', 'Clinical Nurse', 'Nurse Practitioner'])
        self.assertEqual(saved['target_roles'][0]['also'], ['rn'])
        self.assertIn('rn', saved['role_keywords'])
        self.assertIn('nurse practitioner', saved['role_keywords'])
        self.assertNotIn('staff nurse', saved['role_keywords'])
        self.assertEqual(saved['jobs_board_search_queries'], ['Registered Nurse', 'Charge Nurse', 'Clinical Nurse', 'Nurse Practitioner'])

    def test_notion_home_a_page_still_showing_the_two_old_lists_is_read_as_one_list(self):
        old_page = ('Format 2\n## Roles to look for\n- registered nurse\n- rn\n- staff nurse\n## Job board searches\n- Registered Nurse\n- Staff Nurse\n')
        values = s.parse(old_page)
        self.assertEqual([r['title'] for r in values[('search', ('target_roles',))]], ['Registered Nurse', 'Staff Nurse', 'rn'])
        self.assertNotIn(('search', ('role_keywords',)), values)

    def test_notion_home_a_stale_two_list_page_keeps_an_unmerged_cache_two_lists_for_the_ai_to_merge(self):
        class Tracker:
            def page_text(self, page_id):
                return 'Format 2\n## Roles to look for\n- registered nurse\n- rn\n- agency nurse\n## Job board searches\n- Registered Nurse\n'
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(s, 'CONFIG', Path(tmp)):
            (Path(tmp) / 'search.json').write_text(json.dumps({'role_keywords': ['registered nurse', 'rn'], 'jobs_board_search_queries': ['Registered Nurse']}))
            s.sync(Tracker(), 'page')
            kept = json.loads((Path(tmp) / 'search.json').read_text())
        self.assertNotIn('target_roles', kept)   # an edit made on the page is kept, and the merge still waits for the AI
        self.assertIn('agency nurse', kept['role_keywords'])
        self.assertTrue(t.unmigrated(kept))

    def test_notion_home_a_stale_two_list_page_never_undoes_a_merged_cache(self):
        class Tracker:
            def page_text(self, page_id):
                return 'Format 2\n## Roles to look for\n- registered nurse\n- rn\n## Job board searches\n- Registered Nurse\n'
        merged = t.migrate({'role_keywords': ['registered nurse', 'rn'], 'jobs_board_search_queries': ['Registered Nurse']}, ask=grouped)
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(s, 'CONFIG', Path(tmp)):
            (Path(tmp) / 'search.json').write_text(json.dumps(merged))
            s.sync(Tracker(), 'page')
            kept = json.loads((Path(tmp) / 'search.json').read_text())
        self.assertEqual(kept['target_roles'], merged['target_roles'])


if __name__ == '__main__':
    unittest.main()
