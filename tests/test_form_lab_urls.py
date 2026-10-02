"""The form lab's page choice (tools/form_lab_urls.py): aimed at where users are, not uniform."""
import random
import sys
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
from form_lab_urls import allocate  # noqa: E402

FEEDS = ([{'ats': 'greenhouse', 'slug': f'g{i}'} for i in range(40)] + [{'ats': 'ashby', 'slug': f'a{i}'} for i in range(40)]
         + [{'ats': 'lever', 'slug': f'l{i}'} for i in range(40)])


def jobs_of(feed):
    return f"https://boards.example/{feed['ats']}/{feed['slug']}/1"


class FormLabUrlsTest(unittest.TestCase):
    def test_the_head_is_revisited_first_and_fills_its_share(self):
        plan = {'head': [{'fingerprint': 'a', 'urls': [f'https://head.example/{i}' for i in range(30)]}], 'boards': []}
        urls = allocate(FEEDS, plan, 20, random.Random(1), jobs_of)
        self.assertEqual(len(urls), 20)
        self.assertEqual(sum(u.startswith('https://head.example/') for u in urls), 12)   # 60% of 20, the rest is demand and exploration

    def test_demand_follows_where_users_fill_forms(self):
        plan = {'head': [], 'boards': [{'board': 'ashby', 'weight': 95}, {'board': 'greenhouse', 'weight': 5}]}
        counts = Counter()
        for seed in range(30):
            for url in allocate(FEEDS, plan, 20, random.Random(seed), jobs_of):
                counts[url.split('/')[3]] += 1
        self.assertGreater(counts['ashby'], 3 * counts['greenhouse'])      # the busy board gets most of the visits
        self.assertGreater(counts['lever'], 0)                             # exploration still finds the rest

    def test_without_a_plan_the_prior_is_used_and_nothing_repeats(self):
        urls = allocate(FEEDS, {}, 25, random.Random(2), jobs_of)
        self.assertEqual(len(urls), 25)
        self.assertEqual(len(set(urls)), 25)

    def test_dead_feeds_are_skipped_and_a_short_list_is_fine(self):
        alive = {'g0', 'g1'}
        urls = allocate(FEEDS, {}, 10, random.Random(3), lambda feed: jobs_of(feed) if feed['slug'] in alive else None)
        self.assertEqual(sorted(urls), sorted(jobs_of({'ats': 'greenhouse', 'slug': slug}) for slug in alive))


if __name__ == '__main__':
    unittest.main()
