"""Remove only disposable render directories after a successful export."""
import os
from pathlib import Path
import re
import shutil
import stat

DISPOSABLE = (".cache", "bundle", "frames", "tmp")


def keep_intermediates(config):
    value = config.get("保留渲染中间文件", False)
    if type(value) is not bool:
        raise ValueError("保留渲染中间文件 必须是 true 或 false")
    return value


def clean_render_files(output, job, keep=False):
    if keep:
        return {"retained": True, "removed_bytes": 0, "removed": [], "errors": []}
    output, job = Path(output).resolve(), Path(job)
    # Require a direct, named job in this output's .work. Never delete the job
    # itself, its lock, history, source, plan, or shared acoustic caches.
    if job.resolve().parent != output / ".work" or not re.fullmatch(r"[0-9a-f]{12}", job.name):
        raise ValueError("拒绝清理配置输出目录以外或非标准任务目录")
    def checked(path):
        info = path.lstat()
        if path.is_symlink() or getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise ValueError(f"拒绝清理含目录链接的路径：{path}")
        if not path.resolve().is_relative_to(output / ".work"):
            raise ValueError(f"清理路径越界：{path}")
        return info
    checked(job.parent)
    checked(job)
    candidates = []
    for name in DISPOSABLE:
        target = job / name
        if not os.path.lexists(target):
            continue
        checked(target)
        size = 0
        for root, dirs, files in os.walk(target, followlinks=False):
            for child in dirs + files:
                info = checked(Path(root) / child)
                if stat.S_ISREG(info.st_mode):
                    size += info.st_size
        candidates.append((target, size))
    # Validate every target before deleting any; called while holding WorkLock.
    report = {"retained": False, "removed_bytes": 0, "removed": [], "errors": []}
    for target, size in candidates:
        try:
            shutil.rmtree(target)
            report["removed"].append(target.name)
            report["removed_bytes"] += size
        except OSError as error:
            report["errors"].append(f"{target.name}: {error}")
    return report
