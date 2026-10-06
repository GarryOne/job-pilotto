"""Find employers checks candidates in parallel threads; each progress line must stay its own line with its own count
(6 Oct 2026: "Pädagogische Hochschule BernScout: checked 6 of 15")."""
import io
import re
import threading
import time
import unittest
from contextlib import redirect_stdout

from src import scout


class ProgressLines(unittest.TestCase):
    def test_parallel_progress_lines_never_join(self):
        out, n = io.StringIO(), 200
        done = []

        class SlowPipe(io.StringIO):   # writes as slow as the app's pipe: the old print() joined lines here every time
            def write(self, text):
                time.sleep(0.0005)
                return out.write(text)

        def tick(name):
            with scout.PROGRESS_LOCK:
                done.append(name)
                scout.progress_line(f'Scout: checked {len(done)} of {n}: {name}')
        with redirect_stdout(SlowPipe()):
            threads = [threading.Thread(target=tick, args=(f'Employer {i}',)) for i in range(n)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
        lines = out.getvalue().splitlines()
        self.assertEqual(len(lines), n)
        self.assertTrue(all(re.fullmatch(r'Scout: checked \d+ of 200: Employer \d+', line) for line in lines))
        self.assertEqual(sorted(int(line.split()[2]) for line in lines), list(range(1, n + 1)))


if __name__ == '__main__':
    unittest.main()
