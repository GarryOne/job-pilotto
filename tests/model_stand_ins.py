"""Stand-ins for the model's answers in src/ai/meanings.py, for tests about what the code does with an answer (the model decides in any
language; without AI the code says "don't know"). Use one as a test module's setUpModule: `from tests.model_stand_ins import rounds as setUpModule`."""
import re
import unittest
from unittest import mock


def _patch(name, fake):
    from src.ai import meanings
    patch = mock.patch.object(meanings, name, fake)
    patch.start()
    unittest.addModuleCleanup(patch.stop)


def round_answer(round_):
    text = round_ or ''
    return ('technical' if re.search(r'technical|tech|system design|coding|take.home|architecture', text, re.I)
            else 'hiring_manager' if re.search(r'hiring manager|manager|culture|final|director', text, re.I)
            else 'recruiter_screen' if re.search(r'screen|recruiter|talent|phone|intro', text, re.I) else 'other')


def rounds():
    _patch('round_kind', round_answer)


def booking():
    _patch('asks_to_book', lambda note: bool(re.search(r'book|slot|schedul|calendly|availab|pick a time', note or '', re.I)))


def screens():
    """Only "is it a recruiter screen" (what the stage move asks), the way the interview tests name their rounds."""
    _patch('round_kind', lambda round_: 'recruiter_screen' if re.search(r'screen|recruiter|talent|phone|intro', round_ or '', re.I) else 'other')
