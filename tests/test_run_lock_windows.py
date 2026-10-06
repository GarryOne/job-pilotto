"""run_lock on Windows: msvcrt locks the byte at the file position, so lock and unlock must hit the same byte (6 Oct 2026: PermissionError at every run's end)."""
import os
import sys
import tempfile
import types
import unittest
from unittest import mock

from src import paths


class FakeMsvcrt(types.SimpleNamespace):
    """Records where each lock/unlock lands and refuses an unlock of a byte that is not locked, like Windows does."""

    def __init__(self):
        super().__init__(LK_NBLCK=2, LK_UNLCK=0, held=set(), calls=[])

    def locking(self, fd, mode, nbytes):
        at = os.lseek(fd, 0, os.SEEK_CUR)
        self.calls.append((mode, at))
        if mode == self.LK_UNLCK:
            if at not in self.held:
                raise PermissionError(13, 'Permission denied')
            self.held.discard(at)
        else:
            self.held.add(at)


class RunLockWindows(unittest.TestCase):
    def test_unlocks_the_byte_it_locked_after_writing_its_note_and_a_reader_does_not_move_it(self):
        fake = FakeMsvcrt()
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(sys, 'platform', 'win32'), mock.patch.dict(sys.modules, {'msvcrt': fake}):
            with open(os.path.join(folder, 'run.lock'), 'w') as old:
                old.write('{"pid": 1, "label": "an earlier run"}')   # a note left by an earlier holder: the file position starts past it
            with paths.run_lock(folder=folder, label='jobs check'):
                with open(os.path.join(folder, 'run.lock')) as note:
                    self.assertIn('jobs check', note.read())   # the note is readable while the lock is held
        self.assertEqual([at for _, at in fake.calls], [paths.WIN_LOCK_BYTE, paths.WIN_LOCK_BYTE])
        self.assertEqual(fake.held, set())


if __name__ == '__main__':
    unittest.main()
