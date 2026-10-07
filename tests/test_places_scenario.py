"""A whole refresh's place decisions, step by step, as on 7 Oct 2026 (owner: "so many bugs around it, and still regressing"): a Geneva search
with suburbs (Carouge, Petit-Lancy), a posting whose address says only "Switzerland" but whose text says Geneva, Zürich and England jobs; then
a change of places (Lausanne out, Gland in) and a refresh whose AI has not answered yet, then one where it has. The AI is scripted from a
small map (nearest place and km, like the real answers); every path that decides a job's place (cleanup, import filter, digest, scoring
order) is checked at each step. Each assertion names the day's bug it guards against."""
import json
import pathlib
import re
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from src import digest, store, time_budget
from src.ai import insights
from src.ai import engine, place_triage
from src.paths import place_regex
from src.sources import feeds

# location -> (the place it is in or next to, km); None: no place of its own
GEO = {'carouge': ('geneva', 3), 'petit-lancy, switzerland': ('geneva', 4), 'genève, switzerland': ('geneva', 0), 'meyrin, switzerland': ('geneva', 8),
       'lausanne': ('lausanne', 0), 'gland, vaud': ('gland', 0), 'zürich, switzerland': ('zürich', 0), 'derby, england': ('derby', 0),
       'switzerland': None}
JOBS = [('Carouge', 'Vendeuse'), ('Petit-Lancy, Switzerland', 'Magasinière'), ('Genève, Switzerland', 'Vendeur'), ('Meyrin, Switzerland', 'Caissier'),
        ('Lausanne', 'Vendeur'), ('Gland, Vaud', 'Vendeuse'), ('Zürich, Switzerland', 'Verkäufer'), ('Derby, England', 'Sales assistant'),
        ('Switzerland', 'Vendeuse jouets'), ('Switzerland', 'Vendeur polyvalent')]
TEXT = {'Vendeuse jouets': 'Geneva | Part-time 45%. We are looking, at the Geneva site, for a sales assistant. ' * 4,
        'Vendeur polyvalent': 'Our stores across the country look for a seller. Many tasks, a friendly team, training on the job. ' * 4}


def search(*places):
    return {'locations': {'top_tier': list(places), 'country_wide': [], 'abroad': []}, 'remote_jobs': ['No'], 'role_keywords': ['vend'],
            'remote_excluded_regions': []}


class Geography:
    """Answers like the real model for the map above: best within 10 km of one of their best places."""
    def __init__(self):
        self.calls = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        content = kwargs['messages'][0]['content']
        self.calls.append(content)
        best = set(json.loads(re.search(r'Their places \(JSON\): (\{.*\})', content).group(1))['best_places']) if 'Their places' in content else set()
        if 'The postings:' in content:
            postings = content.split('The postings:\n', 1)[1].split('\n\n')
            answer = {'jobs': [{'n': n, 'where': 'Geneva' if 'Geneva site' in text else '', 'nearest': 'geneva', 'km': 0,
                                'answer': ('best' if 'geneva' in best else 'out') if 'Geneva site' in text else 'unclear'}
                               for n, text in enumerate(postings, 1)]}
        elif content.startswith('The job locations:'):
            lines = content.split('The job locations:\n', 1)[1].split('\n')
            answer = {'vague': [int(line.split('.', 1)[0]) for line in lines if GEO.get(line.split('. ', 1)[1], 0) is None]}
        elif 'Countries:' in content:
            answer = {'visa': []}
        else:
            lines = content.split('The job locations:\n', 1)[1].split('\n')
            located = []
            for line in lines:
                n, location = int(line.split('.', 1)[0]), line.split('. ', 1)[1]
                near = GEO.get(location)
                ok = near is not None and near[0] in best and near[1] <= 10
                located.append({'n': n, 'where': location, 'country': 'Switzerland', 'nearest': near[0] if near else 'none',
                                'km': near[1] if near else -1, 'answer': 'best' if ok else 'out'})
            answer = {'locations': located}
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(answer))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class PlacesScenarioTests(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.db = store.connect(self.tmp / 'jobs.sqlite').__enter__()
        for n, (location, title) in enumerate(JOBS):
            store.upsert_job(self.db, {'company': f'Shop {n}', 'title': title, 'url': f'https://jobs.test/{n}', 'location': location,
                                       'description': TEXT.get(title, 'A job in a shop. ' * 20)}, 'jobs.test')
        self.db.commit()
        self.ai = Geography()
        self.patches = [mock.patch.object(place_triage, 'STORE', self.tmp / 'places.json'), mock.patch.object(place_triage, 'READ_STORE', self.tmp / 'read.json'),
                        mock.patch.object(place_triage, '_preferences', lambda: {}), mock.patch.object(engine, 'client', lambda **_: self.ai),
                        mock.patch.object(engine, 'ready', lambda *_: True), mock.patch.object(feeds, 'wanted_title', lambda title: True),
                        mock.patch.object(feeds, 'REMOTE_WANTED', False)]
        for patch in self.patches:
            patch.start()
        time_budget.start(0)

    def tearDown(self):
        for patch in reversed(self.patches):   # the same setting patched twice (a change of places): undone newest first
            patch.stop()
        feeds.PLACED = feeds.READ = None
        self.db.close()

    def places(self, *words):
        """The owner changes their places: every module that keeps them sees the new ones, and the answers start over."""
        found, regex = search(*words), place_regex(list(words))
        for target, name, value in [(feeds, '_SEARCH', found), (feeds, 'PLACE', regex), (digest, 'HOME', regex), (digest, 'BEST_PLACES', regex),
                                    (digest, '_SEARCH', {**digest._SEARCH, 'locations': found['locations']})]:
            patch = mock.patch.object(target, name, value)
            patch.start()
            self.patches.append(patch)
        feeds.PLACED = feeds.READ = None

    def refresh(self, ai_answers=True):
        """What a refresh does about places: the open jobs placed (unless its time is gone), then the cleanup."""
        if ai_answers:
            feeds.place_open_jobs(self.db)
        else:
            with mock.patch.object(time_budget, 'in_calls', lambda *a, **k: 0):
                feeds.place_open_jobs(self.db)
        store.close_elsewhere(self.db, feeds.keep_open)

    def open_places(self):
        return sorted(row[0] for row in self.db.execute("SELECT location FROM jobs WHERE state='open'"))

    def job(self, location, title=None):
        row = self.db.execute('SELECT location, title, url, description FROM jobs WHERE location=? AND (? IS NULL OR title=?)', (location, title, title)).fetchone()
        return {'location': row[0], 'title': row[1], 'url': row[2], 'description': row[3]}

    def test_a_change_of_places_keeps_the_right_jobs_at_every_step(self):
        self.places('geneva', 'lausanne')
        self.refresh()
        self.assertEqual(self.open_places(), ['Carouge', 'Genève, Switzerland', 'Lausanne', 'Meyrin, Switzerland', 'Petit-Lancy, Switzerland', 'Switzerland'],
                         'Geneva suburbs kept, Zürich/England/Gland out; of the two "Switzerland" postings, the one whose text says Geneva stays')
        manor = self.job('Switzerland', 'Vendeuse jouets')
        self.assertTrue(digest.in_places(manor), 'the digest says the Geneva posting is in your places')

        # Lausanne out, Gland in; this refresh's AI time is gone before it places anything (7 Oct 2026: Carouge and Meyrin closed here)
        self.places('geneva', 'gland')
        self.refresh(ai_answers=False)
        for location in ['Carouge', 'Petit-Lancy, Switzerland', 'Meyrin, Switzerland', 'Genève, Switzerland']:
            self.assertIn(location, self.open_places(), f'{location} waits for the AI, it is not closed by the place words')
        self.assertFalse(feeds.wanted_location({'location': 'Derby, England'}), '"gland" is not in "England" (7 UK jobs came in)')
        self.assertFalse(digest.in_places({'location': 'Derby, England'}))

        self.refresh()
        self.assertEqual(self.open_places(), ['Carouge', 'Genève, Switzerland', 'Meyrin, Switzerland', 'Petit-Lancy, Switzerland', 'Switzerland'],
                         'placed again: Lausanne out; the Geneva area and the Geneva posting kept')
        self.assertEqual(feeds.place_of(self.job('Carouge')), 'best')
        self.assertTrue(feeds.wanted_location({'location': 'Gland, Vaud'}), 'a job in Gland is wanted now')
        self.assertEqual(feeds.place_of(manor), 'best', 'the posting was read again for the new places')

    def test_every_path_answers_the_same_for_one_job(self):
        """Import filter, cleanup, digest label, digest rank and scoring order agree (7 Oct 2026: each had its own word fallback)."""
        self.places('geneva', 'gland')
        self.refresh()
        for location in ['Carouge', 'Petit-Lancy, Switzerland', 'Zürich, Switzerland', 'Derby, England', 'Gland, Vaud']:
            job = {'location': location, 'title': 'Vendeur'}
            wanted = feeds.wanted_location(job)
            self.assertEqual(digest.in_places(job), wanted, location)
            self.assertEqual(feeds.keep_open(job), wanted, location)
            self.assertEqual(digest.location_points(job) == 5, wanted, location)
            self.assertEqual(time_budget.best_first([{'location': 'Nowhere'}, job])[0] is job, wanted, location)
            self.assertEqual(insights.region(job) == 'Best places', wanted, location)

    def test_no_path_reads_the_place_words_by_itself(self):
        """A place pattern is only tested in feeds (mentions) and digest.place_rank: one answer, Claude's first."""
        offenders = []
        for path in pathlib.Path('src').rglob('*.py'):
            for n, line in enumerate(path.read_text().splitlines(), 1):
                if re.search(r'\b(BEST_PLACES|HOME|PLACE|PREFERRED_ABROAD)\.search\(', line):
                    offenders.append(f'{path}:{n}')
        self.assertEqual(offenders, [], 'use feeds.mentions / digest.place_rank')


if __name__ == '__main__':
    unittest.main()
