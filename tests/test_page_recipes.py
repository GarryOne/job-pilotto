"""Batch B: recipes learned from one AI read (src/sources/page_recipes.py), the AI link chooser, and the job-title check that tells menu
entries from jobs without AI. Fake models only."""
import json
import shutil
import sqlite3
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src import employer_index  # noqa: E402
from src.ai import page_reader  # noqa: E402
from src.sources import ats, careers, page_recipes  # noqa: E402

LISTING = ('<nav><a href="/de/about">Über uns</a><a href="/de/jobs">Jobs</a></nav>'
           '<ul><li><a href="/de/jobs/devops-engineer">DevOps Engineer 80-100%</a></li><li><a href="/de/jobs/sre">Site Reliability Engineer</a></li>'
           '<li><a href="/de/jobs/hr-lead">HR Lead</a></li></ul>')
SECTIONS = ('<h2 class="intro">Karriere bei Acme</h2><div class="job"><h3 class="job-title">DevOps Engineer (m/w/d)</h3><p>Zürich</p></div>'
            '<div class="job"><h3 class="job-title">Plattform-Ingenieur 100%</h3><p>Bern</p></div><h3 class="news">Firmenlauf 2026</h3>')
BASE = 'https://acme.ch/de/jobs'


def jobs(*pairs):
    return [ats._job(url or f'{BASE}#{i}', title, '', url or BASE) for i, (title, url) in enumerate(pairs)]


class RecipeTests(unittest.TestCase):
    def test_a_link_recipe_is_derived_from_the_models_answer_and_replays_without_it(self):
        answer = jobs(('DevOps Engineer 80-100%', 'https://acme.ch/de/jobs/devops-engineer'), ('Site Reliability Engineer', 'https://acme.ch/de/jobs/sre'))
        recipe = page_recipes.derive(LISTING, BASE, answer)
        self.assertEqual(recipe, {'kind': 'links', 'prefix': '/de/jobs'})
        titles = [title for title, _ in page_recipes.replay(recipe, LISTING, BASE)]
        self.assertEqual(titles, ['DevOps Engineer 80-100%', 'Site Reliability Engineer', 'HR Lead'])   # a new job on the page is read too

    def test_a_section_recipe_reads_jobs_written_as_headings(self):
        answer = jobs(('DevOps Engineer (m/w/d)', None), ('Plattform-Ingenieur 100%', None))
        recipe = page_recipes.derive(SECTIONS, BASE, answer)
        self.assertEqual(recipe, {'kind': 'tag', 'tag': 'h3', 'class': 'job-title'})
        self.assertEqual([t for t, _ in page_recipes.replay(recipe, SECTIONS, BASE)], ['DevOps Engineer (m/w/d)', 'Plattform-Ingenieur 100%'])

    def test_no_recipe_when_the_answer_cannot_be_replayed_or_the_pattern_grabs_everything(self):
        self.assertIsNone(page_recipes.derive(LISTING, BASE, jobs(('Something else', None))))
        many = ''.join(f'<a href="/x/{i}">Item {i}</a>' for i in range(30))
        self.assertIsNone(page_recipes.derive(many, 'https://acme.ch/x', jobs(('Item 1', 'https://acme.ch/x/1'))))

    def test_only_the_fixed_shape_is_ever_valid(self):
        for bad in ({'kind': 'links', 'prefix': '/(a|b)+'}, {'kind': 'regex', 'pattern': '.*'}, {'kind': 'tag', 'tag': 'script', 'class': 'x'},
                    {'kind': 'tag', 'tag': 'h3', 'class': 'x"><script>'}, {'kind': 'links', 'prefix': '/a', 'extra': 1}, 'links', None):
            self.assertFalse(page_recipes.valid(bad), bad)
            self.assertEqual(page_recipes.replay(bad, LISTING, BASE), [])

    def test_recipes_are_kept_per_page_and_come_from_the_index_when_not_learned_here(self):
        db = sqlite3.connect(':memory:')
        page_recipes.save(BASE, {'kind': 'links', 'prefix': '/de/jobs'}, db=db)
        self.assertEqual(page_recipes.load(BASE, db), {'kind': 'links', 'prefix': '/de/jobs'})
        page_recipes.forget(BASE, db)
        index = {'feeds': [{'ats': 'careers', 'slug': 'acme.ch__de__jobs', 'recipe': {'kind': 'links', 'prefix': '/de/jobs'}}]}
        with mock.patch.object(employer_index, '_read', return_value=index):
            self.assertEqual(page_recipes.load(BASE, db), {'kind': 'links', 'prefix': '/de/jobs'})


class ReadingWithRecipesTests(unittest.TestCase):
    def setUp(self):
        saved = careers.READER, careers.RENDER, careers.CHOOSER
        careers.RENDER = careers.CHOOSER = None
        self.addCleanup(lambda: (setattr(careers, 'READER', saved[0]), setattr(careers, 'RENDER', saved[1]), setattr(careers, 'CHOOSER', saved[2])))

    def test_a_recipe_answers_before_any_model_is_asked(self):
        careers.READER = lambda url, markup: self.fail('the recipe should answer')
        with mock.patch.object(page_recipes, 'load', return_value={'kind': 'tag', 'tag': 'h3', 'class': 'job-title'}):
            got = careers._asked(BASE, SECTIONS, [ats._job('x', 'Über uns', '', 'x')], fetch_page=lambda url: '')
        self.assertEqual([j['title'] for j in got], ['DevOps Engineer (m/w/d)', 'Plattform-Ingenieur 100%'])

    def test_menu_entries_are_told_from_jobs_without_ai(self):
        menu = [ats._job(str(i), t, '', 'x') for i, t in enumerate(['Über uns', 'Benefits', 'Kontakt'])]
        real = [ats._job(str(i), t, '', 'x') for i, t in enumerate(['Produktionsleiter (m/w) 100%', 'Konstrukteur 80-100%', 'Über uns'])]
        self.assertFalse(careers._plausible(menu))
        self.assertTrue(careers._plausible(real))


class FakeClient:
    def __init__(self, answer):
        self.calls, self.answer = [], answer
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(self.answer))], usage=None)


class ChooserTests(unittest.TestCase):
    HOME = '<a href="/produkte">Produkte</a><a href="/unternehmen/arbeiten-bei-uns">Arbeiten bei uns</a><a href="/kontakt">Kontakt</a>'

    def setUp(self):
        page_reader._reads['n'] = 0
        self.db = sqlite3.connect(':memory:')

    def test_the_model_picks_from_the_pages_own_links_and_is_asked_once_per_site(self):
        client = FakeClient({'links': ['https://acme.ch/unternehmen/arbeiten-bei-uns', 'https://evil.example/x']})
        self.assertEqual(page_reader.choose_links('https://acme.ch', self.HOME, client, self.db), ['https://acme.ch/unternehmen/arbeiten-bei-uns'])
        page_reader.choose_links('https://acme.ch', self.HOME, client, self.db)
        self.assertEqual(len(client.calls), 1)
        self.assertIn('untrusted', client.calls[0]['system'][0]['text'])

    def test_discover_follows_the_chosen_link_when_the_rules_found_nothing(self):
        careers_saved = careers.CHOOSER, careers.READER, careers.RENDER
        self.addCleanup(lambda: (setattr(careers, 'CHOOSER', careers_saved[0]), setattr(careers, 'READER', careers_saved[1]), setattr(careers, 'RENDER', careers_saved[2])))
        careers.READER = careers.RENDER = None
        careers.CHOOSER = lambda site, home: ['https://acme.ch/unternehmen/arbeiten-bei-uns']
        pages = {'https://acme.ch': self.HOME, 'https://acme.ch/unternehmen/arbeiten-bei-uns': '<script type="application/ld+json">' + json.dumps(
            {'@type': 'JobPosting', 'title': 'DevOps Engineer', 'url': '/jobs/devops', 'jobLocation': {'address': {'addressLocality': 'Zürich', 'addressCountry': 'CH'}}}) + '</script>'}
        fetch = lambda url: pages[url] if url in pages else (_ for _ in ()).throw(OSError(url))
        found = careers.discover('acme.ch', fetch)
        self.assertEqual(found['slug'], 'acme.ch__unternehmen__arbeiten-bei-uns')


class IndexCarriesRecipesTests(unittest.TestCase):
    def test_the_engine_keeps_a_valid_recipe_from_the_index_and_drops_a_bad_one(self):
        served = [{'company': 'A', 'ats': 'careers', 'slug': 'a.ch__jobs', 'recipe': {'kind': 'links', 'prefix': '/jobs'}},
                  {'company': 'B', 'ats': 'careers', 'slug': 'b.ch__jobs', 'recipe': {'kind': 'regex', 'pattern': '.*'}}]
        self.assertEqual([f.get('recipe') for f in employer_index.clean(served)], [{'kind': 'links', 'prefix': '/jobs'}, None])

    @unittest.skipUnless(shutil.which('node'), 'node is not installed')
    def test_the_website_accepts_exactly_the_recipes_the_engine_accepts(self):
        samples = [{'kind': 'links', 'prefix': '/de/jobs'}, {'kind': 'tag', 'tag': 'h3', 'class': 'job-title'}, {'kind': 'links', 'prefix': '/(a)+'},
                   {'kind': 'tag', 'tag': 'script', 'class': 'x'}, {'kind': 'tag', 'tag': 'h3', 'class': 'job', 'x': 1}]
        script = ("import {recipeOf} from './src/employers.js'; console.log(JSON.stringify(JSON.parse(process.argv[1]).map(r => !!recipeOf(r))));")
        out = subprocess.run(['node', '--input-type=module', '-e', script, json.dumps(samples)], cwd=ROOT / 'site', capture_output=True, text=True, timeout=60)
        self.assertEqual(json.loads(out.stdout), [page_recipes.valid(r) for r in samples])


if __name__ == '__main__':
    unittest.main()
