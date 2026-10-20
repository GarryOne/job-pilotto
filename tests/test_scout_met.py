"""The employers a person met reach the scout (owner, 20 Oct 2026: every company a user meets, whichever way: a pasted job link, "Applied elsewhere",
a recruiter lead, a mail): read from the store's application rows, first in the queue, also on a day the shared list needs no new names.
No network."""
import tempfile
import unittest
from pathlib import Path

from src import scout, scout_candidates, scout_core
from src import store as job_store
from src.stores import memory
from tests.test_scout import SEEDS


def stores_with(*rows):
    stores = memory.open_store()
    for row in rows:
        stores.applications.create(row, 'Applied')
    return stores


GREENHOUSE = {'url': 'https://boards.greenhouse.io/acme/jobs/1', 'company': 'Acme Care', 'title': 'Nurse'}
OTHER = {'url': 'https://careers.example.org/job/77', 'company': 'Example Hotels'}
NO_COMPANY = {'url': 'https://careers.example.org/job/78', 'company': ''}


class MetCompanyTests(unittest.TestCase):
    def test_every_application_row_with_an_employer_is_a_candidate_with_the_job_system_its_link_names(self):
        found = list(scout_candidates.met_company_candidates(stores_with(GREENHOUSE, OTHER, NO_COMPANY, dict(OTHER, url='https://x.example.org/2'))))
        self.assertEqual([(c['name'], c['origin'], c['ats'], c['slug']) for c in found],
                         [('Acme Care', 'Met by you', 'greenhouse', 'acme'), ('Example Hotels', 'Met by you', None, None)])
        self.assertTrue(all(set(c) <= {'name', 'origin', 'priority', 'ats', 'slug'} for c in found), 'a name and a feed address, never a title or text')

    def test_a_store_that_cannot_list_leaves_the_scout_with_its_other_sources(self):
        class Broken:
            class applications:  # noqa: N801
                @staticmethod
                def list():
                    raise OSError('Notion is down')
        self.assertEqual(list(scout_candidates.met_company_candidates(Broken())), [])

    def test_they_are_added_once_first_in_the_queue_and_move_a_queued_name_up(self):
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            scout_core.ensure_tables(db)
            db.execute("INSERT INTO scout_candidates (key, name, origin, priority, status, added_at) VALUES ('examplehotels', 'Example Hotels', 'Board employer', 65, 'pending', '2026-10-20T10:00:00')")
            db.commit()
            stores = stores_with(GREENHOUSE, OTHER)
            self.assertEqual(scout_candidates.harvest_met(db, SEEDS, stores), 1)
            self.assertEqual(scout_candidates.harvest_met(db, SEEDS, stores), 0)
            rows = {r['name']: (r['origin'], r['priority']) for r in db.execute('SELECT name, origin, priority FROM scout_candidates')}
            self.assertEqual(rows['Acme Care'], ('Met by you', scout_candidates.MET_PRIORITY))
            self.assertEqual(rows['Example Hotels'], ('Board employer', scout_candidates.MET_PRIORITY))
            self.assertEqual(scout.next_batch(db, 1)[0]['name'] in ('Acme Care', 'Example Hotels'), True)

    def test_no_store_adds_nothing(self):
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
            self.assertEqual(scout_candidates.harvest_met(db, SEEDS, None), 0)

    def test_a_met_employer_is_checked_on_a_covered_day_like_a_manual_watch_and_other_names_are_not(self):
        self.assertTrue(scout_candidates.counts_when_covered({'status': 'pending', 'origin': 'Met by you'}))
        self.assertTrue(scout_candidates.counts_when_covered({'status': 'manual', 'origin': 'x'}))
        self.assertFalse(scout_candidates.counts_when_covered({'status': 'pending', 'origin': 'Board employer'}))


if __name__ == '__main__':
    unittest.main()
