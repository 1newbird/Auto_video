"""Use this project's own fixed encoder."""
from pathlib import Path
import runpy
import sys

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).resolve().parent / "runtime/scripts/stream_encode.py"
if __name__ == "__main__":
    runpy.run_path(str(SCRIPT), run_name="__main__")
else:
    encode = runpy.run_path(str(SCRIPT))["encode"]
