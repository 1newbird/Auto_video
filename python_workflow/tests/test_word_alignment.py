import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from word_alignment import map_words

class WordAlignmentTests(unittest.TestCase):
    def test_word_offsets_map_to_subtitle_and_audio(self):
        cue={'text':'读 Skill，按需。','startSeconds':10,'endSeconds':12}
        words=map_words(cue,{'text':'读 skill按需','timestamp':[[0,200],[220,600],[650,800],[820,1000]]})
        self.assertEqual(words[1]['from'],1)
        self.assertEqual(words[1]['to'],6)
        self.assertEqual(words[1]['startSeconds'],10.22)
        self.assertEqual(words[-1]['endSeconds'],11)

    def test_bad_model_alignment_is_not_repaired_by_proportion(self):
        cue={'text':'测试','startSeconds':0,'endSeconds':2}
        for result in [{'text':'测试','timestamp':[[0,500]]},{'text':'错字','timestamp':[[0,500],[500,1000]]},
                       {'text':'测试','timestamp':[[0,500],[500,4000]]}]:
            with self.subTest(result=result),self.assertRaises(ValueError):map_words(cue,result)
