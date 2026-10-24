"""The skills the AI read from a posting reach each Jobs-list row, from every store: SQLite facts, store matches, Notion's Technologies column."""
import unittest

from src import desktop_jobs, desktop_store_jobs


class Matches:
    def __init__(self, rows): self.rows = rows
    def list(self): return self.rows


class Stores:
    def __init__(self, rows):
        self.matches = Matches(rows)
        self.applications = Matches([])


class JobSkillsTest(unittest.TestCase):
    def test_skills_of_splits_dedupes_and_caps(self):
        self.assertEqual(desktop_jobs.skills_of('Palliativpflege; Wundversorgung ;; Palliativpflege'), ['Palliativpflege', 'Wundversorgung'])
        self.assertEqual(desktop_jobs.skills_of(['Kat. CE', ' Tachograph ', '']), ['Kat. CE', 'Tachograph'])
        self.assertEqual(desktop_jobs.skills_of(None), [])
        self.assertEqual(len(desktop_jobs.skills_of([str(n) for n in range(20)])), 8)

    def test_store_rows_carry_the_technologies_column(self):
        rows = desktop_store_jobs.store_jobs(Stores([{'url': 'https://x.test/1', 'title': 'Nurse', 'technologies': 'Wound care; Night shift'}]))
        self.assertEqual(rows[0]['technologies'], 'Wound care; Night shift')


if __name__ == '__main__':
    unittest.main()
