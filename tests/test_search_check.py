"""The on-demand live job-search check (tools/persona-search/search-check.mjs, skill check-job-search-locally; owner, 19 Oct 2026): on the Claude plan, no API key, a throwaway folder."""
import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANDIDATES = ['finance', 'music', 'driver', 'sre', 'cluj', 'chisinau']


def node(code):
    out = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return json.loads(out.strip().splitlines()[-1])


def dry(*args):
    return json.loads(subprocess.run(['node', 'tools/persona-search/search-check.mjs', *args, '--dry'], cwd=ROOT, capture_output=True, text=True, check=True).stdout)


class SearchCheck(unittest.TestCase):
    def test_every_candidate_and_random_plan_one_press_on_the_plan_engine_in_a_throwaway_folder(self):
        for who in [*CANDIDATES, 'random']:
            step = dry(who)
            self.assertEqual(step['engine'], 'cli (the Claude plan)', who)
            self.assertNotIn('--engine', step['run'], f'{who}: the plan engine is run.mjs\'s default; --engine api is the CI draw')
            self.assertEqual(step['run'][step['run'].index('--presses') + 1], '1', who)
            self.assertIn('--fresh', step['run'], who)
            self.assertIn('jp-search-check-', step['out'], who)
            self.assertNotIn('Library/Application Support', step['out'], f'{who}: never the app\'s folder')
        self.assertEqual(dry('random', '--seed', 'abc')['seed'], 'abc')
        self.assertEqual(dry('driver')['name'], 'driver')
        self.assertEqual(dry('random')['name'], 'draw')

    def test_an_unknown_candidate_is_refused(self):
        self.assertNotEqual(subprocess.run(['node', 'tools/persona-search/search-check.mjs', 'nobody', '--dry'], cwd=ROOT, capture_output=True).returncode, 0)

    def test_no_api_key_or_upload_key_reaches_the_run(self):
        env = node("import {cleanEnv, FORBIDDEN_ENV} from './tools/persona-search/search-check.mjs';"
                   "const all = Object.fromEntries(FORBIDDEN_ENV.map(k => [k, 'x']));"
                   "console.log(JSON.stringify([Object.keys(cleanEnv({...all, PATH: '/bin', HOME: '/h'})), FORBIDDEN_ENV]))")
        self.assertEqual(sorted(env[0]), ['HOME', 'PATH'])
        for name in ('ANTHROPIC_API_KEY', 'LAB_HEAL_ANTHROPIC_KEY', 'RANDOM_DRAWS_ANTHROPIC_KEY', 'REPLAYS_PUBLISH_KEY'):
            self.assertIn(name, env[1])

    def test_the_numbers_sit_beside_the_earlier_runs_of_the_same_candidate(self):
        lines = node("import {summary} from './tools/persona-search/search-check.mjs';"
                     "const row = {candidate: 'driver', label: 'driver', state: 'ok', first_s: 30, tenth_s: 100, fit_s: null, in_places: 40, scored: 30, fit70: 5};"
                     "const old = f => ({candidate: 'driver', first_s: f, tenth_s: 90, fit_s: 400, in_places: 36, scored: 30, fit70: 4});"
                     "console.log(JSON.stringify([summary(row, [old(40), old(50), {...old(999), candidate: 'music'}]), summary(row, [])]))")
        self.assertIn('Time to first job: 30 s (earlier median 40 s over 2 runs)', lines[0])
        self.assertIn('Time to first 70+ job: not reached (earlier median 6:40 over 2 runs)', lines[0])
        self.assertIn('Time to first job: 30 s (no earlier local run)', lines[1])

    def test_the_skill_says_what_it_uses_and_has_its_own_name(self):
        text = (ROOT / '.claude' / 'skills' / 'check-job-search-locally' / 'SKILL.md').read_text(encoding='utf-8')
        self.assertTrue(text.startswith('---\nname: check-job-search-locally\n'))
        for word in ('$0 API', 'search-check.mjs', 'throwaway', 'tee', 'Monitor', 'random-draw.yml', 'asks first', 'ANTHROPIC_API_KEY'):
            self.assertIn(word, text)


if __name__ == '__main__':
    unittest.main()
