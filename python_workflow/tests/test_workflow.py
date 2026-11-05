from contextlib import contextmanager
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
from main import load_config, resolved_path, run_command
from model_client import generate_plan, parse_plan, ModelError
from stream_encode import encode


@contextmanager
def server(status=200, answer=None):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append({"path": self.path, "data": data})
            result = answer(data) if callable(answer) else answer
            body = json.dumps(result if result is not None else {"error": "fake-key"}).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    try:
        yield {"base_url": f"http://127.0.0.1:{http.server_port}/v1", "name": "local-test", "api_key": "fake-key"}, requests
    finally:
        http.shutdown()
        http.server_close()
        thread.join()


class WorkflowTests(unittest.TestCase):
    def test_diagnostic_script_uses_one_short_request_and_redacts_key(self):
        import test_model
        answer = {"choices": [{"message": {"content": '{"ok":true}'}, "finish_reason": "stop"}]}
        output = io.StringIO()
        with tempfile.TemporaryDirectory(dir=HERE) as folder, server(answer=answer) as (config, requests):
            with patch.object(test_model, "load_config", return_value={"model": config, "output_dir": folder}), patch.object(sys, "argv", ["test_model.py"]), redirect_stdout(output):
                result = test_model.main()
            self.assertTrue((Path(folder) / "model-tests/latest-success.json").exists())
        self.assertEqual(result, 0)
        self.assertEqual(len(requests), 1)
        self.assertIn("HTTP 200", output.getvalue())
        self.assertIn("测试成功", output.getvalue())
        self.assertNotIn("fake-key", output.getvalue())
        self.assertNotIn("source", requests[0]["data"]["messages"][0]["content"])

    def test_waiting_progress_is_visible_before_response(self):
        output = io.StringIO()
        def delayed_answer(data):
            time.sleep(5.2)
            self.assertIn("仍在等待", output.getvalue())
            return {"choices": [{"message": {"content": '{"pages":[{}]}'}, "finish_reason": "stop"}]}
        with server(answer=delayed_answer) as (config, requests), redirect_stdout(output):
            generate_plan(config, "JSON", {})
        self.assertEqual(len(requests), 1)
        self.assertIn("调用成功", output.getvalue())
        self.assertNotIn("fake-key", output.getvalue())

    def test_process_error_is_visible_and_stops(self):
        output = io.StringIO()
        with redirect_stdout(output), self.assertRaisesRegex(RuntimeError, "退出码 7"):
            run_command([sys.executable, "-c", "import sys; print('specific failure'); sys.exit(7)"], os.environ.copy())
        self.assertIn("specific failure", output.getvalue())

    def test_one_request_and_feedback(self):
        answer = {"choices": [{"message": {"content": '{"pages":[{"id":"p1"}]}'}, "finish_reason": "stop"}], "usage": {"total_tokens": 12}}
        with server(answer=answer) as (config, requests):
            raw, usage = generate_plan(config, "Output JSON", {"text": "原稿"}, {"pages": []}, "改红色")
        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(request["path"], "/v1/chat/completions")
        self.assertNotIn("tools", request["data"])
        user = json.loads(request["data"]["messages"][1]["content"])
        self.assertEqual(user["feedback"], "改红色")
        self.assertIn("previous_plan", user)
        self.assertEqual(parse_plan(raw)["pages"][0]["id"], "p1")
        self.assertEqual(usage["total_tokens"], 12)

    def test_http_failure_does_not_retry_or_expose_key(self):
        with server(status=429) as (config, requests):
            with self.assertRaises(ModelError) as error:
                generate_plan(config, "JSON", {})
        self.assertEqual(len(requests), 1)
        self.assertNotIn("fake-key", str(error.exception))
        self.assertIn("429", str(error.exception))

    def test_truncated_model_output_stops(self):
        with server(answer={"choices": [{"finish_reason": "length", "message": {"content": "{}"}}]}) as (config, requests):
            with self.assertRaisesRegex(ModelError, "length"):
                generate_plan(config, "JSON", {})
        self.assertEqual(len(requests), 1)

    def test_json_and_config_paths(self):
        self.assertEqual(parse_plan('```json\n{"pages":[{}]}\n```'), {"pages": [{}]})
        with self.assertRaisesRegex(ModelError, "JSON"):
            parse_plan("broken output")
        with tempfile.TemporaryDirectory(dir=HERE) as folder:
            root = Path(folder)
            file = root / "test.yaml"
            file.write_text('input_file: input.txt\noutput_dir: output\n', encoding="utf-8")
            config = load_config(file)
            self.assertEqual(resolved_path(config["input_file"], root), root / "input.txt")

    def test_streamed_frame_order_and_alpha_without_composite_files(self):
        from PIL import Image
        ffmpeg = HERE / "runtime/node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe"
        with tempfile.TemporaryDirectory(dir=HERE) as folder:
            root = Path(folder)
            a, b, caption = root / "a.png", root / "b.png", root / "caption.png"
            Image.new("RGB", (64, 48), (255, 0, 0)).save(a)
            Image.new("RGB", (64, 48), (0, 255, 0)).save(b)
            overlay = Image.new("RGBA", (64, 48), (0, 0, 0, 0))
            for x in range(20):
                for y in range(20):
                    overlay.putpixel((x, y), (0, 0, 255, 255))
            overlay.save(caption)
            out = root / "test.mp4"
            result = encode({"ffmpeg": str(ffmpeg), "output": str(out), "fps": 30, "frames": 5,
                             "states": [{"board": str(a), "caption": None, "frames": 2},
                                        {"board": str(b), "caption": str(caption), "frames": 3}]})
            subprocess.run([str(ffmpeg), "-v", "error", "-i", str(out), "-vsync", "0", str(root / "frame-%d.png")], check=True)
            self.assertEqual(len(list(root.glob("frame-*.png"))), 5)
            for frame in range(5):
                with Image.open(root / f"frame-{frame + 1}.png") as image:
                    rgb = image.convert("RGB").getpixel((32, 32))
                self.assertGreater(rgb[0 if frame < 2 else 1], 240)
            with Image.open(root / "frame-3.png") as image:
                self.assertGreater(image.convert("RGB").getpixel((8, 8))[2], 240)
            self.assertFalse((root / "composite").exists())
            self.assertEqual(result["compositesCreated"], 0)


if __name__ == "__main__":
    unittest.main()
