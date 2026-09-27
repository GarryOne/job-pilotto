import io
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import transcribe

try:
    import numpy
except ImportError:  # the add-on isn't installed (CI): the pure-Python parts are still tested
    numpy = None


class TranscribeTests(unittest.TestCase):
    def test_tokens_become_words_with_their_start_time(self):
        words = transcribe.tokens_to_words([' Hi', ' Ig', 'or', ',', ' thanks'], [0.1, 0.4, 0.5, 0.6, 0.9], offset=10)
        self.assertEqual(words, [(10.1, 'Hi'), (10.4, 'Igor,'), (10.9, 'thanks')])
        self.assertEqual(transcribe.tokens_to_words(['▁So', '▁we'], [0, 0.2]), [(0.0, 'So'), (0.2, 'we')])

    def test_words_go_to_the_speaker_talking_then_or_the_nearest(self):
        segments = [(0.0, 4.0, 7), (4.5, 9.0, 3), (9.2, 12.0, 7)]
        words = [(0.5, 'Hello'), (4.2, 'um'), (5.0, 'Sure'), (8.9, 'done'), (9.1, 'Next'), (15.0, 'bye')]
        self.assertEqual([s for _, s, _ in transcribe.assign(words, segments)], [7, 7, 3, 3, 3, 7])
        self.assertEqual(transcribe.assign([(1.0, 'x')], []), [(1.0, 0, 'x')])

    def test_turns_are_numbered_by_first_speaker_and_you_is_named(self):
        labelled = [(0, 7, 'Hi'), (1, 7, 'there.'), (3, 3, 'Hello.'), (5, 7, 'Question?'), (8, 5, 'Me'), (9, 5, 'too.')]
        turns = transcribe.turns(labelled)
        self.assertEqual(transcribe.render(turns), '[00:00:00] Speaker 1: Hi there.\n[00:00:03] Speaker 2: Hello.\n'
                                                   '[00:00:05] Speaker 1: Question?\n[00:00:08] Speaker 3: Me too.')
        turns = transcribe.turns(labelled, you=3)
        self.assertEqual([s for _, s, _ in turns], [1, 0, 1, 2])
        self.assertIn('[00:00:03] You: Hello.', transcribe.render(turns))
        self.assertEqual(transcribe.clock(3725), '01:02:05')

    @unittest.skipUnless(numpy, 'numpy not installed')
    def test_you_is_the_voice_on_the_microphone_channel(self):
        rate = transcribe.RATE
        left, right = numpy.zeros(rate * 6, numpy.float32), numpy.zeros(rate * 6, numpy.float32)
        left[:rate * 2] = 0.03; right[:rate * 2] = 0.2      # the interviewer: in the call, a little echo on the mic
        left[rate * 2:rate * 4] = 0.3                        # the candidate: on the mic only
        right[rate * 4:] = 0.2                               # a second interviewer
        segments = [(0, 2, 5), (2, 4, 1), (4, 6, 2)]
        self.assertEqual(transcribe.find_you(numpy.stack([left, right]), segments), 1)
        same = numpy.stack([left + right, left + right])     # an ordinary stereo file: nobody is "you"
        self.assertIsNone(transcribe.find_you(same, segments))
        self.assertIsNone(transcribe.find_you(None, segments))

    def test_models_download_once(self):
        def archive(url):  # each release archive holds its model folder
            data = io.BytesIO()
            with tarfile.open(fileobj=data, mode='w:bz2') as tar:
                name = next(rel for u, rel in transcribe.MODELS.values() if u == url)
                info = tarfile.TarInfo(name); info.size = 2
                tar.addfile(info, io.BytesIO(b'ok'))
            return data.getvalue()
        fetched = []

        def opener(url, timeout=None):
            fetched.append(url)
            return io.BytesIO(archive(url) if url.endswith('.tar.bz2') else b'onnx')
        with tempfile.TemporaryDirectory() as folder, mock.patch('sys.stderr', io.StringIO()):
            paths = transcribe.ensure_models(folder, opener)
            self.assertTrue(all(path.exists() for path in paths.values()))
            self.assertEqual(len(fetched), 4)
            transcribe.ensure_models(folder, opener)
            self.assertEqual(len(fetched), 4)
            self.assertFalse(list(Path(folder).glob('*.part')))

    def test_available_follows_the_switch(self):
        with mock.patch.dict(transcribe.os.environ, {'JOB_PILOTTO_DISABLE': 'transcribe'}):
            self.assertFalse(transcribe.available())


if __name__ == '__main__':
    unittest.main()
