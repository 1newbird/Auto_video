import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from audio_inputs import parse_srt, parse_word_srt, prepare_audio
from unittest.mock import patch, MagicMock

def word_srt(parts):
    return '\n\n'.join(f'{i+1}\n00:00:{i:02d},000 --> 00:00:{i:02d},500\n{text}' for i,text in enumerate(parts))

class AudioInputsTests(unittest.TestCase):
    def test_timestamps_multiline_and_tts_tags(self):
        cues=parse_srt('\ufeff1\r\n00:00:00,000 --> 00:00:02,300\r\n你好(breath)\r\n世界。\r\n\r\n2\r\n00:00:03,001 --> 00:00:04,000\r\n结束。')
        self.assertEqual(cues[0]['text'],'你好 世界。')
        self.assertEqual(cues[0]['endSeconds'],2.3)
        self.assertEqual(cues[1]['startSeconds'],3.001)
        self.assertEqual(cues[1]['id'],'s002')

    def test_invalid_or_overlapping_cues_rejected(self):
        for text in ['', 'hello', '1\n00:00:02,000 --> 00:00:01,000\n坏时间',
                     '1\n00:00:00,000 --> 00:00:02,000\n一\n\n2\n00:00:01,000 --> 00:00:03,000\n二']:
            with self.subTest(text=text),self.assertRaises(ValueError):
                parse_srt(text)

    def test_word_fragments_keep_real_times_and_normalized_offsets(self):
        cues=parse_word_srt(word_srt(['讲','Har','ness','。','(breath)','重','点','！']))
        self.assertEqual([c['text'] for c in cues],['讲Harness。','重点！'])
        self.assertEqual([(w['from'],w['to']) for w in cues[0]['words']],[(0,1),(1,4),(4,8)])
        self.assertEqual(cues[0]['words'][2]['startSeconds'],2)
        self.assertEqual(cues[1]['words'][0]['startSeconds'],5)
        self.assertEqual(cues[1]['id'],'s002')

    def test_controls_do_not_hide_invalid_timestamps(self):
        text='1\n00:00:00,000 --> 00:00:02,000\n(breath)\n\n2\n00:00:01,000 --> 00:00:03,000\n词'
        with self.assertRaises(ValueError): parse_word_srt(text)
        with self.assertRaises(ValueError): parse_word_srt(word_srt(['(breath)']))

    def test_import_marks_direct_alignment_only_when_enabled(self):
        folder=MagicMock()
        folder.__truediv__.return_value.read_text.return_value=word_srt(['重','点','。'])
        folder.__truediv__.return_value.read_bytes.return_value=b'audio'
        with patch('audio_inputs.shutil.copyfile'),patch('audio_inputs.probe',return_value={'format':{'duration':'4'},'streams':[{'codec_type':'audio'}]}):
            for enabled in [True,False]:
                _,timeline=prepare_audio(Path('a.mp3'),Path('a.word.srt'),folder,Path('.'),keyword_sync=enabled)
                self.assertEqual('alignment' in timeline,enabled)
                self.assertEqual(timeline['wordImport']['wordCount'],2)

    def test_trailing_control_outside_audio_is_rejected(self):
        folder=MagicMock()
        folder.__truediv__.return_value.read_text.return_value=word_srt(['字','。','(breath)'])
        with patch('audio_inputs.shutil.copyfile'),patch('audio_inputs.probe',return_value={'format':{'duration':'2'},'streams':[{'codec_type':'audio'}]}):
            with self.assertRaisesRegex(ValueError,'超过音频'):
                prepare_audio(Path('a.mp3'),Path('a.word.srt'),folder,Path('.'))
