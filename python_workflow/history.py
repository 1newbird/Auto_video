"""Per-run artifacts and logs; reusable render caches stay outside the history."""
from contextlib import ExitStack, redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import threading
import traceback
import uuid


def timestamp():
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + "." + uuid.uuid4().hex[:8] + ".tmp")
    try:
        temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def within(root, target):
    if not Path(target).resolve().is_relative_to(Path(root).resolve()):
        raise RuntimeError(f"运行目录必须位于配置输出目录内：{target}")


class Tee:
    def __init__(self, terminal, log, key, mutex):
        self.terminal, self.log, self.key, self.mutex = terminal, log, key, mutex

    def write(self, text):
        safe = text.replace(self.key, "[redacted]") if self.key else text
        with self.mutex:
            self.terminal.write(safe)
            self.log.write(safe)
            self.log.flush()
        return len(text)

    def flush(self):
        with self.mutex:
            self.terminal.flush()
            self.log.flush()


class RunRecord:
    def __init__(self, output, key=""):
        self.output = Path(output).resolve()
        self.key = key
        root = self.output / "runs"
        within(self.output, root)
        root.mkdir(parents=True, exist_ok=True)
        self.id = datetime.now(timezone(timedelta(hours=8))).strftime("%Y%m%d-%H%M%S-%f") + "-" + uuid.uuid4().hex[:4]
        self.path = root / self.id
        self.path.mkdir()
        self.state = {"schemaVersion": 1, "run_id": self.id, "status": "running", "started_at": timestamp()}
        self.stack = ExitStack()

    def pointer(self):
        return {"run_id": self.id, "status": self.state["status"], "directory": self.path.relative_to(self.output).as_posix()}

    def update(self, **values):
        self.state.update(values)
        write_json(self.path / "run.json", self.state)

    def __enter__(self):
        log = self.stack.enter_context((self.path / "run.log").open("x", encoding="utf-8"))
        self.log = log
        mutex = threading.RLock()
        self.stack.enter_context(redirect_stdout(Tee(sys.stdout, log, self.key, mutex)))
        self.stack.enter_context(redirect_stderr(Tee(sys.stderr, log, self.key, mutex)))
        self.update()
        write_json(self.output / "latest-run.json", self.pointer())
        print(f"[历史] 本次记录：{self.path}", flush=True)
        return self

    def succeed(self, result):
        write_json(self.path / "result.json", result)
        self.update(status="success", stage="done", finished_at=timestamp())
        pointer = self.pointer()
        if result.get("video"):
            pointer["video"] = Path(result["video"]).relative_to(self.output).as_posix()
        write_json(self.output / "latest-success.json", pointer)

    def __exit__(self, kind, value, tb):
        try:
            if kind:
                error = str(value).replace(self.key, "[redacted]") if self.key else str(value)
                self.update(status="cancelled" if issubclass(kind, KeyboardInterrupt) else "failed", error=error, finished_at=timestamp())
                detail = "".join(traceback.format_exception(kind, value, tb))
                self.log.write(detail.replace(self.key, "[redacted]") if self.key else detail)
                print(f"[历史] 本次未完成，原稿、计划及日志保存在：{self.path}", flush=True)
            write_json(self.output / "latest-run.json", self.pointer())
        finally:
            self.stack.close()


class WorkLock:
    """An OS lock is released even when an IDE kills Python; file existence is harmless."""
    def __init__(self, directory):
        self.path = Path(directory) / "work.lock"

    def __enter__(self):
        self.file = self.path.open("a+b")
        if self.file.seek(0, 2) == 0:
            self.file.write(b" ")
            self.file.flush()
        self.file.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.file.close()
            raise RuntimeError("同一份原稿已有任务正在运行，请等它完成后再 Run。") from None
        return self

    def __exit__(self, *args):
        self.file.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(self.file.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(self.file.fileno(), fcntl.LOCK_UN)
        self.file.close()


def previous_plan(output, source_hash, job):
    """Prefer immutable run history, with a read-only fallback for pre-history jobs."""
    output = Path(output)
    candidates = sorted((output / "runs").glob("*/plan.json"), key=lambda p: p.stat().st_mtime_ns, reverse=True)
    candidates += [Path(job) / "plan.json", output / "plan.json"]
    for path in candidates:
        try:
            plan = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(plan, dict) and plan.get("sourceHash") == source_hash:
                return plan, path
        except (OSError, ValueError):
            continue
    return None, None


def mark_interrupted(output, job, current_id):
    """Call only after acquiring the work lock: an older holder can no longer run."""
    for path in (Path(output) / "runs").glob("*/run.json"):
        try:
            state = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if state.get("status") == "running" and state.get("run_id") != current_id and state.get("work_dir") == str(job):
            state.update(status="interrupted", detected_at=timestamp(), error="上次进程在完成前退出；本次已成功重新取得工作锁。")
            write_json(path, state)
