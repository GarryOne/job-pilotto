"""tools/check-slot.sh (9 Oct 2026): at most N push checks at once on this Mac; a dead owner's slot is taken over; the exit code is kept."""
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT = str(Path(__file__).resolve().parent.parent / 'tools/check-slot.sh')


def run(args, slot_dir, slots='1', wait='20', **kw):
    env = dict(os.environ, JOB_PILOTTO_CHECK_SLOT_DIR=slot_dir, JOB_PILOTTO_CHECK_SLOTS=slots, JOB_PILOTTO_CHECK_WAIT=wait)
    return subprocess.Popen(['bash', SCRIPT, *args], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, **kw)


class SlotTests(unittest.TestCase):
    def test_the_command_runs_and_its_exit_code_is_kept(self):
        with tempfile.TemporaryDirectory() as d:
            p = run(['bash', '-c', 'echo hi; exit 3'], d)
            out, _ = p.communicate(timeout=20)
            self.assertEqual((p.returncode, out.strip()), (3, 'hi'))
            self.assertEqual(os.listdir(d), [])                       # the slot is freed

    def test_a_second_run_waits_for_the_first_with_one_slot(self):
        with tempfile.TemporaryDirectory() as d:
            first = run(['sleep', '4'], d)
            time.sleep(1)
            started = time.time()
            second = run(['true'], d)
            _, err = second.communicate(timeout=30)
            self.assertGreaterEqual(time.time() - started, 2)
            self.assertIn('waiting for a free slot', err)
            first.communicate()

    def test_a_slot_whose_owner_is_gone_is_taken_over_at_once(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / 'slot1').mkdir()
            (Path(d) / 'slot1' / 'pid').write_text('999999')           # no such process
            started = time.time()
            p = run(['true'], d)
            _, err = p.communicate(timeout=20)
            self.assertLess(time.time() - started, 5)
            self.assertNotIn('waiting', err)

    def test_zero_slots_skips_the_queue(self):
        with tempfile.TemporaryDirectory() as d:
            p = run(['echo', 'x'], d, slots='0')
            out, _ = p.communicate(timeout=10)
            self.assertEqual(out.strip(), 'x')


if __name__ == '__main__':
    unittest.main()
