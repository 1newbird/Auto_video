import os
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from render_storage import clean_render_files, keep_intermediates


class RenderStorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.job = self.root / '.work' / '0123456789ab'
        self.job.mkdir(parents=True)
        for name in ('.cache', 'bundle', 'tmp', 'frames'):
            (self.job / name).mkdir()
            (self.job / name / 'asset').write_bytes(b'1234')
        (self.job / 'plan.json').write_text('{}')
        (self.job / 'work.lock').touch()
        (self.root / 'runs').mkdir()
        (self.root / 'runs' / 'lesson.mp4').write_bytes(b'video')

    def test_default_removes_only_disposable_files(self):
        self.assertFalse(keep_intermediates({}))
        result = clean_render_files(self.root, self.job)
        self.assertEqual(result['removed_bytes'], 16)
        self.assertFalse((self.job / '.cache').exists())
        self.assertTrue((self.job / 'plan.json').exists())
        self.assertTrue((self.job / 'work.lock').exists())
        self.assertTrue((self.root / 'runs' / 'lesson.mp4').exists())

    def test_retention_and_invalid_settings(self):
        self.assertTrue(clean_render_files(self.root, self.job, True)['retained'])
        self.assertTrue((self.job / '.cache' / 'asset').exists())
        for value in ['false', 1, None]:
            with self.assertRaises(ValueError): keep_intermediates({'保留渲染中间文件': value})

    def test_wrong_root_and_job_are_not_deleted(self):
        for job in [self.root, self.root / '.work', self.root / 'runs', self.job]:
            with self.assertRaises(ValueError): clean_render_files(self.root / 'different-output', job)
        self.assertTrue((self.job / '.cache').exists())

    def test_link_rejected_before_any_deletion(self):
        # Emulate a reparse-point marker without requiring Windows symlink privileges.
        original = Path.is_symlink
        with patch.object(Path, 'is_symlink', lambda p: p.name == 'bundle' or original(p)):
            with self.assertRaisesRegex(ValueError, '链接'): clean_render_files(self.root, self.job)
        self.assertTrue((self.job / '.cache').exists())

    def test_busy_file_is_reported(self):
        with patch('render_storage.shutil.rmtree', side_effect=PermissionError('busy')):
            result = clean_render_files(self.root, self.job)
        self.assertEqual(len(result['errors']), 4)
        self.assertEqual(result['removed_bytes'], 0)

    def test_yaml_plan_selects_offline_path_and_cli_takes_precedence(self):
        import main
        config = self.root / 'config.json'
        config.write_text(json.dumps({'output_dir': str(self.root), '复用计划': 'saved/plan.json'}), encoding='utf-8')
        for cli, expected in [(None, self.root / 'saved/plan.json'), (self.root / 'cli.json', self.root / 'cli.json')]:
            with patch('main.RunRecord'), patch('main.execute', side_effect=RuntimeError('stop before execution')) as execute:
                with self.assertRaisesRegex(RuntimeError, 'stop before execution'):
                    main.run(config, cli)
            self.assertEqual(execute.call_args.args[2], expected)
