import hashlib
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from audio_inputs import parse_word_srt, normalized_word
from subtitle_normalization import can_reuse_original_plan


def srt(parts, gap=0):
    def stamp(ms):
        return f'00:{ms//60000:02d}:{ms//1000%60:02d},{ms%1000:03d}'
    return '\n\n'.join(f'{i+1}\n{stamp(i*(100+gap))} --> {stamp(i*(100+gap)+100)}\n{p}'
                       for i, p in enumerate(parts))


class NormalizationTests(unittest.TestCase):
    def parse(self, parts, reference, **kw):
        report = {}
        cues = parse_word_srt(srt(parts, **kw), reference_text=reference, normalization_report=report)
        return cues, report

    def test_numeric_spans_and_date_keep_interval_and_offsets(self):
        parts = ['公司发布于', '2024', '2024', '2024', '年', '11', '11', '月正式上线。']
        original = parse_word_srt(srt(parts))
        cues, report = self.parse(parts, '公司发布于2024年11月正式上线。')
        self.assertEqual(cues[0]['text'], '公司发布于2024年11月正式上线。')
        self.assertEqual(len(report['changes']), 2)
        for key in ('id', 'startSeconds', 'endSeconds'):
            self.assertEqual(cues[0][key], original[0][key])
        year = cues[0]['words'][1]
        self.assertEqual((year['startSeconds'], year['endSeconds']), (.1, .4))
        offset = 0
        for w in cues[0]['words']:
            self.assertEqual(w['from'], offset)
            self.assertEqual(normalized_word(cues[0]['text'])[w['from']:w['to']], normalized_word(w['text']))
            offset = w['to']
        self.assertEqual(offset, len(normalized_word(cues[0]['text'])))

    def test_english_suffix_not_repeated_punctuation(self):
        cues, report = self.parse(['全称是ModelContextPro', 'to', 'col，', 'l，', '翻译过来就是协议。'],
                                 '全称是 Model Context Protocol，翻译过来就是协议。')
        self.assertEqual(cues[0]['text'], '全称是ModelContextProtocol，翻译过来就是协议。')
        self.assertEqual(report['changes'][0]['kind'], 'english-tail')
        self.assertEqual(cues[0]['words'][2]['endSeconds'], .4)

    def test_chinese_and_intentional_ascii_repetitions_preserved(self):
        parts = ['我说的就是', '对', '对', '对，', '再报一次', '100', '100', '都是正确答案。']
        cues, report = self.parse(parts, ''.join(parts))
        self.assertEqual(cues[0]['text'], ''.join(parts))
        self.assertFalse(report['changes'])
        self.assertTrue(report['unresolved'])

    def test_unrelated_reference_and_missing_reference_do_not_guess(self):
        parts = ['这里要接入', '100', '100', '个外部服务。']
        for reference in ('完全不同的稿件。', ''):
            cues, report = self.parse(parts, reference)
            self.assertEqual(cues[0]['text'], ''.join(parts))
            self.assertFalse(report.get('changes'))

    def test_repeated_reference_is_ambiguous(self):
        parts = ['这里要接入', '100', '100', '个外部服务。']
        cues, report = self.parse(parts, '这里要接入100个外部服务。' * 2)
        self.assertEqual(cues[0]['text'], ''.join(parts))
        self.assertFalse(report['changes'])

    def test_nonadjacent_times_preserved(self):
        parts = ['这里要接入', '100', '100', '个外部服务。']
        cues, report = self.parse(parts, '这里要接入100个外部服务。', gap=200)
        self.assertEqual(cues[0]['text'], ''.join(parts))
        self.assertFalse(report['changes'])

    def test_only_import_hash_transition_can_reuse_plan(self):
        parts = ['这里要接入', '100', '100', '个外部服务。']
        cues, report = self.parse(parts, '这里要接入100个外部服务。')
        before = hashlib.sha256(''.join(parts).encode()).hexdigest()
        after = hashlib.sha256(cues[0]['text'].encode()).hexdigest()
        timeline = {'subtitleNormalization': report}
        self.assertTrue(can_reuse_original_plan(before, after, timeline))
        self.assertFalse(can_reuse_original_plan('other-plan', after, timeline))
        self.assertFalse(can_reuse_original_plan(before, 'other-input', timeline))
        self.assertFalse(can_reuse_original_plan(before, after, None))

    def test_sentence_boundaries_and_breathing_unchanged(self):
        parts = ['第一句结束。', '(breath)', '这里要接入', '100', '100', '个外部服务。']
        original = parse_word_srt(srt(parts))
        cues, report = self.parse(parts, '第一句结束。这里要接入100个外部服务。')
        self.assertEqual([(c['id'], c['startSeconds'], c['endSeconds']) for c in original],
                         [(c['id'], c['startSeconds'], c['endSeconds']) for c in cues])
        self.assertEqual(report['changes'][0]['segment'], 's002')


if __name__ == '__main__':
    unittest.main()
