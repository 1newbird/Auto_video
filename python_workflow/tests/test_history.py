from contextlib import redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import main
from history import RunRecord, WorkLock, mark_interrupted, previous_plan


class HistoryTests(unittest.TestCase):
    def test_failed_rerun_preserves_success_video_and_plan_and_redacts_log(self):
        with tempfile.TemporaryDirectory(dir=HERE) as folder, redirect_stdout(io.StringIO()):
            root = Path(folder)
            source = root / "input.md"
            source.write_text("原稿内容。", encoding="utf-8")
            source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
            plan = root / "plan.json"
            plan.write_text(json.dumps({"pages": [{}], "sourceHash": source_hash}), encoding="utf-8")
            output = root / "output"
            output.mkdir()
            (output / "lesson.mp4").write_bytes(b"legacy video")
            config = root / "config.json"
            config.write_text(json.dumps({"input_file": str(source), "output_dir": str(output), "model": {"api_key": "secret-test-key"}}), encoding="utf-8")

            def command(args, env):
                if args[2] == "prepare":
                    work = Path(args[3])
                    (work / "source.json").write_text(json.dumps({"sha256": source_hash}), encoding="utf-8")
                elif args[2] == "compile":
                    work = Path(args[3])
                    (work / "lesson.json").write_text("{}", encoding="utf-8")
                    (work / "captions.srt").write_text("字幕", encoding="utf-8")
                else:
                    work = Path(args[args.index("--out-dir") + 1])
                    (work / "lesson.mp4").write_bytes(b"successful video")
                    (work / "render-manifest.json").write_text(json.dumps({"lesson": {"duration": 1}, "cacheStats": {}}), encoding="utf-8")

            with patch.object(main, "run_command", side_effect=command):
                result = main.run(config, plan)
            success_dir = Path(result["run_dir"])
            saved_plan = (success_dir / "plan.json").read_bytes()
            success_pointer = (output / "latest-success.json").read_bytes()

            def failure(args, env):
                if args[2] == "compile":
                    raise RuntimeError("compile failed secret-test-key")
                command(args, env)

            with patch.object(main, "run_command", side_effect=failure), self.assertRaises(RuntimeError):
                main.run(config, plan)
            latest = json.loads((output / "latest-run.json").read_text(encoding="utf-8"))
            failed_dir = output / latest["directory"]
            self.assertEqual(latest["status"], "failed")
            self.assertNotEqual(success_dir, failed_dir)
            self.assertTrue((failed_dir / "source.md").exists())
            self.assertTrue((failed_dir / "plan.json").exists())
            self.assertFalse((failed_dir / "lesson.mp4").exists())
            self.assertNotIn("secret-test-key", (failed_dir / "run.log").read_text(encoding="utf-8"))
            self.assertEqual((success_dir / "lesson.mp4").read_bytes(), b"successful video")
            self.assertEqual((success_dir / "plan.json").read_bytes(), saved_plan)
            self.assertEqual((output / "latest-success.json").read_bytes(), success_pointer)
            self.assertEqual((output / "lesson.mp4").read_bytes(), b"legacy video")
            self.assertIsNotNone(previous_plan(output, source_hash, Path(result["work_dir"]))[0])

    def test_os_lock_released_after_forced_process_exit(self):
        with tempfile.TemporaryDirectory(dir=HERE) as folder:
            code = "from history import WorkLock; import sys,os; lock=WorkLock(sys.argv[1]); lock.__enter__(); print('locked', flush=True); sys.stdin.readline(); os._exit(9)"
            child = subprocess.Popen([sys.executable, "-B", "-c", code, folder], cwd=HERE, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(), "locked")
                with self.assertRaises(RuntimeError):
                    with WorkLock(folder):
                        pass
                # Exit the actual interpreter without finally blocks (Windows venv
                # launchers may otherwise leave their child interpreter alive).
                child.stdin.write("exit\n")
                child.stdin.flush()
                child.wait(timeout=5)
                with WorkLock(folder):
                    self.assertTrue((Path(folder) / "work.lock").exists())
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=5)
                child.stdin.close()
                child.stdout.close()

    def test_aborted_history_is_marked_when_next_run_acquires_work(self):
        with tempfile.TemporaryDirectory(dir=HERE) as folder, redirect_stdout(io.StringIO()):
            root = Path(folder)
            work = root / ".work" / "same"
            work.mkdir(parents=True)
            old = RunRecord(root)
            old.update(work_dir=str(work))
            with RunRecord(root) as current, WorkLock(work):
                mark_interrupted(root, work, current.id)
                self.assertEqual(json.loads((old.path / "run.json").read_text())["status"], "interrupted")
                current.succeed({})


if __name__ == "__main__":
    unittest.main()
