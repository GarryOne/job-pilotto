"""The Lab Job Search's CI replay (.github/workflows/search-lab.yml, tools/persona-search/tape-store.mjs, lab-upload.mjs): never on a PR, offline with no AI, the six candidates the upload knows,
the newest tape of a candidate chosen exactly, and a replay that lacked an AI answer ending as FAILED rather than thin numbers."""
import json
import pathlib
import re
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORKFLOW = (ROOT / '.github' / 'workflows' / 'search-lab.yml').read_text(encoding='utf-8')
UPLOAD = (ROOT / 'tools' / 'persona-search' / 'lab-upload.mjs').read_text(encoding='utf-8')


def node(code):
    out = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return json.loads(out.strip().splitlines()[-1])


class Workflow(unittest.TestCase):
    def test_never_on_a_pr_and_main_moves_the_page(self):
        self.assertNotIn('pull_request', WORKFLOW)
        self.assertIn('branches: [main]', WORKFLOW)
        self.assertIn('--branch "${{ github.ref_name }}"', WORKFLOW)

    def test_the_replay_is_offline_and_runs_the_candidates_the_upload_knows(self):
        self.assertIn('--replay --no-live', WORKFLOW)
        self.assertNotIn('ANTHROPIC_API_KEY', WORKFLOW, 'no AI account on this workflow')
        matrix = re.search(r'candidate: \[([^\]]+)\]', WORKFLOW).group(1).replace(' ', '').split(',')
        known = re.findall(r"(\w+): '", re.search(r'CANDIDATES = \{(.*?)\};', UPLOAD, re.S).group(1))
        self.assertEqual(sorted(matrix), sorted(known))

    def test_a_crashed_search_is_posted_then_the_job_ends_red(self):
        self.assertIn('continue-on-error: true', WORKFLOW)
        self.assertIn("steps.replay.outcome == 'failure'", WORKFLOW)


class TapeStore(unittest.TestCase):
    def test_the_newest_complete_pair_of_exactly_that_candidate(self):
        names = ['search-tape-sre-20261018T010000Z.tgz.enc', 'search-tape-sre-20261018T010000Z.k.enc', 'search-tape-sre-20261019T010000Z.tgz.enc',
                 'search-tape-sre-2-20261020T010000Z.tgz.enc', 'search-tape-sre-2-20261020T010000Z.k.enc']
        got = node(f"import {{newestPair}} from './tools/persona-search/tape-store.mjs'; console.log(JSON.stringify([newestPair('sre', {json.dumps(names)}), newestPair('nobody', {json.dumps(names)})]))")
        self.assertEqual(got[0], {'bundle': 'search-tape-sre-20261018T010000Z.tgz.enc', 'key': 'search-tape-sre-20261018T010000Z.k.enc'},
                         'the 19 Oct bundle has no key yet, so the 18 Oct pair is used; "sre-2" is another candidate')
        self.assertIsNone(got[1])

    def test_only_replay_lines_count_and_a_changed_search_makes_the_row_tape_stale(self):
        report = '\n'.join(json.dumps(line) for line in [{'mode': 'record', 'ai_missing': 9}, {'mode': 'replay', 'ai_missing': 2, 'web_missing': 5, 'web_tape': 100}, {'mode': 'replay', 'ai_missing': 1, 'web_tape': 50}]) + '\nnot json'
        misses = node(f"import {{replayMisses}} from './tools/persona-search/tape-store.mjs'; console.log(JSON.stringify(replayMisses({json.dumps(report)})))")
        self.assertEqual(misses, {'ai': 3, 'web': 5, 'webTape': 150})

    def test_stale_means_any_missing_ai_answer_or_over_2_percent_of_web_requests(self):
        def note(ai, web, web_tape):
            return node(f"import {{staleNote}} from './tools/persona-search/tape-store.mjs'; console.log(JSON.stringify(staleNote({{ai: {ai}, web: {web}, webTape: {web_tape}}})))")
        self.assertEqual(note(0, 0, 500), '')
        self.assertEqual(note(0, 2, 498), '', '2 of 500 web requests: noise')
        self.assertEqual(note(0, 20, 480), 'Tape stale (0 AI and 20 web requests not recorded)')
        self.assertEqual(note(1, 0, 500), 'Tape stale (1 AI and 0 web requests not recorded)')


class HealWorkflow(unittest.TestCase):
    heal = (ROOT / '.github' / 'workflows' / 'search-lab-heal.yml').read_text(encoding='utf-8')

    def test_the_heal_is_off_until_switched_on_never_on_a_pr_and_on_its_own_key(self):
        self.assertNotIn('pull_request', self.heal)
        self.assertIn("vars.LAB_HEAL_ON == 'true'", self.heal)   # starts OFF (owner 18 Oct 2026): the scheduled run does nothing until the variable is set
        self.assertIn('LAB_HEAL_ANTHROPIC_KEY: ${{ secrets.LAB_HEAL_ANTHROPIC_KEY }}', self.heal)   # apart from the random draws' key and cap
        self.assertNotIn('RANDOM_DRAWS_ANTHROPIC_KEY', self.heal)

    def test_a_new_tape_is_published_only_after_two_replays_agree(self):
        verify, publish = self.heal.index('heal.mjs verify'), self.heal.index('tape-store.mjs publish')
        self.assertLess(verify, publish, 'a tape is verified before it replaces the old one (the step order stops the job on a failed verify)')
        self.assertEqual(self.heal.count('NET_RECORDS_WRITE_TOKEN'), 2, 'the write token is read by the publish step and by the failed heal\'s keep-for-debugging step, both after the verify')
        self.assertGreater(self.heal.rindex('NET_RECORDS_WRITE_TOKEN'), self.heal.index('heal.mjs verify'))
        self.assertGreater(self.heal.index('NET_RECORDS_WRITE_TOKEN'), self.heal.index('heal.mjs verify'))
        self.assertNotIn('lab-upload', self.heal, 'the numbers are posted by the replay workflow, never by the heal')

    def test_a_failed_verify_stops_the_job_before_the_publish(self):
        # 18 Oct 2026: the first heal run printed "NOT accepted" and still published: `cmd | tee` ends with tee's exit unless pipefail is set, and the step's default shell has none.
        for step in re.split(r'\n      - ', self.heal):
            if 'heal.mjs verify' in step:
                self.assertIn('set -o pipefail', step)
        for step in re.split(r'\n      - ', self.heal):
            if '| tee' in step and 'run: |' in step:
                self.assertIn('set -o pipefail', step, 'every multi-line step that pipes into tee stops on the first failure')

    def test_a_proof_run_records_and_checks_but_publishes_nothing(self):
        # 18 Oct 2026: f4's triage fix had to be proved on its branch before it merged, without replacing the tape in the store
        self.assertIn('publish:', self.heal)
        self.assertEqual(self.heal.count("ref: ${{ inputs.ref || github.sha }}"), 2, 'both jobs run the asked code')
        for name in ('- name: Publish the new tape (it is', '- name: Replay it now'):
            step = self.heal[self.heal.index(name):]
            self.assertIn("inputs.publish", step.split('run:')[0], f'{name} is skipped when publish is unticked')

    def test_what_a_replay_lacked_is_logged_as_shapes_only(self):
        # the CI log of this public repo: kinds of question and hosts with counts, never a job title, a company or an address path
        out = node("import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import {shapes} from './tools/persona-search/heal.mjs';"
                   "const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-shapes-')); fs.writeFileSync(path.join(dir, 'missing.jsonl'), ["
                   "JSON.stringify({model: 'm', user: 'Title: Secret Welder at Acme GmbH\\nCompany: Acme'}), JSON.stringify({model: 'm', user: 'Title: Other'}),"
                   "JSON.stringify({web: true, method: 'GET', url: 'https://jobs.example.de/private/path?q=x'})].join('\\n'));"
                   "console.log(JSON.stringify(shapes(dir)))")
        self.assertIn('2 x ai m "Title"', out)
        self.assertIn('1 x web jobs.example.de', out)
        self.assertNotIn('Secret', out)
        self.assertNotIn('private', out)

    def test_the_ai_misses_are_listed_before_the_web_ones_and_each_kind_has_its_own_room(self):
        # 19 Oct 2026, proof 3: 12 web hosts filled the list and the one missing AI question was not shown
        out = node("import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import {shapes} from './tools/persona-search/heal.mjs';"
                   "const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-shapes-')); const rows = [];"
                   "for (let i = 0; i < 20; i++) for (let n = 0; n <= i; n++) rows.push(JSON.stringify({web: true, method: 'GET', url: `https://h${i}.example.de/x`}));"
                   "rows.push(JSON.stringify({model: 'm', user: 'Strings: one'}));"
                   "fs.writeFileSync(path.join(dir, 'missing.jsonl'), rows.join('\\n')); console.log(JSON.stringify(shapes(dir)))")
        lines = out.split('\n')
        self.assertIn('1 x ai m "Strings"', lines[0], 'the AI question is first, though it is the rarest')
        self.assertEqual(sum('x web' in line for line in lines), 12, 'the web hosts are capped on their own')

    def test_a_tape_says_how_it_is_replayed(self):
        # 18 Oct 2026: a tape recorded on the API engine missed 59 AI requests on the plan engine at wait scale 0, 30 on its own engine, and only repeats its search at the recorded pace
        run = (ROOT / 'tools' / 'persona-search' / 'run.mjs').read_text(encoding='utf-8')
        self.assertIn("replay.json", run)
        self.assertIn('"engine": "api", "wait_scale": 1', self.heal)
        self.assertLess(self.heal.index('replay.json'), self.heal.index('tape-store.mjs publish'), 'the file is in the tape that is published')
        self.assertNotIn('--wait-scale', WORKFLOW, 'the replay workflow lets each tape say its own pace')
        self.assertNotIn('--engine', (ROOT / 'tools' / 'persona-search' / 'heal.mjs').read_text(encoding='utf-8').split('export async function replay')[1].split('const file')[0], 'heal replays take the engine from the tape')

    def test_two_replays_never_share_a_working_folder(self):
        # 19 Oct 2026: the heal's two parallel replays both used tmp/jp-persona-<name>-heal-check: one waited for the other's run lock, saw its employer
        # index, scout candidates and cache, and `--fresh` could wipe it mid-run, so "two replays of one tape" differed (7 vs 40 places) whatever the search did
        out = node("import {replayTag} from './tools/persona-search/heal.mjs';"
                   "console.log(JSON.stringify([replayTag('/w/out-a'), replayTag('/w/out-b'), replayTag('/w/out-a'), replayTag('/x/out-a')]))")
        self.assertEqual(len(set(out[:2])), 2, 'replay a and b get their own folders')
        self.assertEqual(out[0], out[2], 'one output folder keeps its tag')
        self.assertNotEqual(out[0], out[3], 'the same file name in another work folder is another replay')
        for tag in out:
            self.assertRegex(tag, r'^heal-check-[0-9a-f]{8}$')

    def test_the_weekly_cap_and_the_pick(self):
        out = node("import {pickCandidate, agree, WEEKLY_CAP} from './tools/persona-search/heal.mjs';"
                   "const press = (more = {}) => ({in_places: 36, scored_in_places: 36, fit70_in_places: 28, stale: '', crashes: [], ...more});"
                   "console.log(JSON.stringify([pickCandidate({sre: 'x', cluj: 'y'}, 0), pickCandidate({sre: 'x'}, WEEKLY_CAP), pickCandidate({driver: ''}, 0),"
                   "agree(press(), press()), agree(press(), press({fit70_in_places: 27})), agree(press(), press({stale: 'Tape stale (1 AI and 0 web requests not recorded)'})), agree(press(), null)]))")
        self.assertEqual(out[:3], ['sre', None, None])
        self.assertEqual(out[3], '')
        self.assertIn('differs', out[4])
        self.assertIn('stale', out[5])
        self.assertTrue(out[6])
        self.assertLessEqual(6 * 0.92, 6.0, 'six heals at the measured $0.92 stay inside $6 a week')


PR_WORKFLOW = (ROOT / '.github' / 'workflows' / 'search-lab-pr.yml').read_text(encoding='utf-8')


class PullRequestReplay(unittest.TestCase):
    """The replay a pull request gets (19 Oct 2026, owner: "Keep, replay on each PR"): $0, read-only, red only for a real Worse."""
    def test_it_is_read_only_free_and_for_this_repository_only(self):
        self.assertIn('pull_request:', PR_WORKFLOW)
        self.assertNotIn('pull_request_target', PR_WORKFLOW)
        self.assertNotRegex(PR_WORKFLOW, r'secrets\.[A-Z_]*(ANTHROPIC|OPENAI|PUBLISH)[A-Z_]*', 'no AI key and no key that writes the Lab page')
        self.assertNotIn('lab-upload', PR_WORKFLOW, 'a PR never writes the Lab page')
        self.assertIn('--no-live', PR_WORKFLOW)
        self.assertRegex(PR_WORKFLOW, r'(?m)^permissions:\n  contents: read\n')
        self.assertIn('github.event.pull_request.head.repo.full_name == github.repository', PR_WORKFLOW, 'a fork gets no tape key: its PR is not run')
        for path in ('src/**', 'desktop/lib/**', 'tools/persona-search/**'):
            self.assertIn(f"- '{path}'", PR_WORKFLOW)

    def test_the_pr_and_main_are_replayed_on_their_own_copies_of_the_tape_and_a_red_compare_stays_red(self):
        # a replay writes its report into the tape's folder, and two replays on one folder disagree (#1538)
        self.assertIn('tape-pr', PR_WORKFLOW)
        self.assertIn('cp -R "$RUNNER_TEMP/tape-pr" "$RUNNER_TEMP/tape-main"', PR_WORKFLOW)
        self.assertIn('--tag "pr-$2"', PR_WORKFLOW, 'a tag for each replay: its own working folder')
        step = PR_WORKFLOW[PR_WORKFLOW.index('- name: Compare'):]
        self.assertIn('set -o pipefail', step, 'the tee at the end must not hide a Worse')
        self.assertIn('base.sha', PR_WORKFLOW, "main's code is the PR's base")

    def test_the_verdicts(self):
        out = node("import {compare} from './tools/persona-search/pr-compare.mjs';"
                   "const row = (more = {}) => ({state: 'ok', in_places: 36, fit70: 28, first_s: 100, tenth_s: 200, fit_s: 400, ...more});"
                   "console.log(JSON.stringify([compare(row(), row()).state, compare(row({in_places: 30}), row()).state, compare(row({fit_s: 520}), row()).state,"
                   "compare(row({fit_s: 520}), row(), true).state, compare(row({first_s: 80, in_places: 40}), row()).state,"
                   "compare({state: 'stale', failed_step: 'Tape stale (3 AI and 0 web requests not recorded)'}, row()).state,"
                   "compare({state: 'failed', failed_step: 'ai'}, row()).state, compare({state: 'failed', failed_step: 'ai'}, {state: 'failed'}).state,"
                   "compare(row(), {state: 'stale'}).state, compare(row(), null).state, compare(row({fit_s: null}), row()).state]))")
        self.assertEqual(out, ['same', 'worse', 'worse', 'worse', 'same', 'stale', 'worse', 'new', 'new', 'new', 'worse'],
                         'a stale tape or no comparison is never red; a lower count, a time over 25% (0% for the control), a crash main does not have, or a time no longer reached is')
        self.assertIn('re-record after the merge', node("import {compare} from './tools/persona-search/pr-compare.mjs';"
                                                       "console.log(JSON.stringify(compare({state: 'stale', failed_step: 'Tape stale (1 AI)'}, null).why.join(' ')))"))


class FailedHealKeepsItsTape(unittest.TestCase):
    """A failed heal's new tape is kept, encrypted, on the private repo for an offline replay (19 Oct 2026: proof 4's tape was discarded and its replay could not be debugged)."""
    def test_only_the_newest_pairs_stay(self):
        out = node("import {oldDebugAssets} from './tools/persona-search/tape-store.mjs';"
                   "const pair = (c, day) => [`search-tape-${c}-202610${day}T100000Z.tgz.enc`, `search-tape-${c}-202610${day}T100000Z.k.enc`];"
                   "const all = ['11', '12', '13', '14', '15', '16', '17'].flatMap(day => pair('driver', day)).concat(['unrelated.txt']);"
                   "console.log(JSON.stringify([oldDebugAssets(all), oldDebugAssets(all, 7), oldDebugAssets(pair('sre', '11'))]))")
        self.assertEqual(out[0], ['search-tape-driver-20261011T100000Z.tgz.enc', 'search-tape-driver-20261011T100000Z.k.enc',
                                  'search-tape-driver-20261012T100000Z.tgz.enc', 'search-tape-driver-20261012T100000Z.k.enc'], 'seven kept pairs of tapes: the oldest two go, the newest five stay')
        self.assertEqual(out[1:], [[], []], 'nothing goes while there are not more than the limit')

    def test_the_failed_heal_uploads_it_encrypted_and_never_as_a_public_artifact(self):
        heal = (ROOT / '.github' / 'workflows' / 'search-lab-heal.yml').read_text(encoding='utf-8')
        step = heal[heal.index("- name: Keep a failed heal's tape"):]
        self.assertIn('if: failure()', step.split('run:')[0])
        self.assertIn('tape-store.mjs publish-debug "$CANDIDATE" "$RUNNER_TEMP/new"', step)
        self.assertNotIn('upload-artifact', heal, 'this repository is public: a tape holds third parties\' pages and is only ever kept encrypted on the private one')
        store = (ROOT / 'tools' / 'persona-search' / 'tape-store.mjs').read_text(encoding='utf-8')
        self.assertIn("DEBUG_TAG = 'search-tapes-debug'", store)
        self.assertIn("'fetch-debug'", store)

    def test_a_stale_row_prints_no_numbers_beside_its_verdict(self):
        out = node("import {line} from './tools/persona-search/pr-compare.mjs';"
                   "const stale = {state: 'stale', in_places: 698, fit70: 0, first_s: 5, fit_s: null}, ok = {state: 'ok', in_places: 36, fit70: 28, first_s: 100, fit_s: 400};"
                   "console.log(JSON.stringify([line('cluj', stale, ok, {state: 'stale', why: ['x']}), line('cluj', ok, stale, {state: 'new', why: ['y']})]))")
        self.assertNotIn('698', out[0])
        self.assertIn('36 → –', out[0], 'main\'s own numbers still print, the PR\'s thin ones do not')
        self.assertIn('– → 36', out[1], 'a stale base prints no numbers, the PR\'s own still do')


if __name__ == '__main__':
    unittest.main()
