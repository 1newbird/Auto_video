import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from video_settings import video_settings


class VideoSettingsTests(unittest.TestCase):
    def test_defaults_and_profiles(self):
        self.assertEqual(video_settings({}), {"resolution":"1080p","width":1080,"height":1920,"fps":30,"showCaptions":True})
        for name,width,height in [("1080p",1080,1920),("1440p",1440,2560),("4K",2160,3840)]:
            for fps in (30,60):
                self.assertEqual(video_settings({"视频":{"清晰度":name,"帧率":fps}}), {"resolution":name,"width":width,"height":height,"fps":fps,"showCaptions":True})

    def test_caption_switch(self):
        self.assertFalse(video_settings({'显示字幕':False})['showCaptions'])
        for value in ('false',None,0,1):
            with self.subTest(value=value),self.assertRaises(ValueError):
                video_settings({'显示字幕':value})

    def test_invalid_values_fail_before_rendering(self):
        for settings in (None,{"清晰度":"8K"},{"帧率":True},{"帧率":24},{"帧率":"60"}):
            with self.subTest(settings=settings),self.assertRaises(ValueError):
                video_settings({"视频":settings})
