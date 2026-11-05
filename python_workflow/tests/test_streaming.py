from contextlib import contextmanager, redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import sys
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model_client import ModelError, request_chat


def chunk(content=None, reasoning=None, finish=None):
    delta = {}
    if content is not None:
        delta["content"] = content
    if reasoning is not None:
        delta["reasoning_content"] = reasoning
    return {"choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}


@contextmanager
def streaming_server(events, progress_seen=None):
    requests, faults = [], []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.end_headers()
            try:
                self.wfile.write(b": keepalive\r\n\r\n")
                for i, event in enumerate(events):
                    text = event if isinstance(event, str) else json.dumps(event, ensure_ascii=False)
                    payload = ("data: " + text + "\r\n\r\n").encode("utf-8")
                    # Split the bytes inside a Chinese character as well as across SSE events.
                    cut = payload.find("中".encode("utf-8")) + 1 if "中" in text else len(payload) // 2
                    self.wfile.write(payload[:cut])
                    self.wfile.flush()
                    self.wfile.write(payload[cut:])
                    self.wfile.flush()
                    if i == 1 and progress_seen is not None and not progress_seen.wait(2):
                        faults.append("No progress was visible before the remaining response was sent")
            except (BrokenPipeError, ConnectionResetError):
                pass

    http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=http.serve_forever, daemon=True)
    worker.start()
    try:
        yield {"base_url": f"http://127.0.0.1:{http.server_port}/v1", "name": "test", "api_key": "fake-key", "timeout_seconds": 4}, requests, faults
    finally:
        http.shutdown()
        http.server_close()
        worker.join()


class StreamingTests(unittest.TestCase):
    def test_incremental_progress_unicode_assembly_and_usage(self):
        progress_seen = threading.Event()

        class Output(io.StringIO):
            def write(self, value):
                result = super().write(value)
                if "接收计划正文" in value:
                    progress_seen.set()
                return result

        output = Output()
        events = [chunk(reasoning="测试思考"), chunk('{"pages":['),
                  chunk('{"title":"中文"}]}'), chunk(finish="stop"),
                  {"choices": [], "usage": {"total_tokens": 20}}, "[DONE]"]
        with streaming_server(events, progress_seen) as (config, requests, faults), redirect_stdout(output):
            raw, usage = request_chat(config, [{"role": "user", "content": "JSON"}])
        self.assertEqual(faults, [])
        self.assertTrue(progress_seen.is_set())
        self.assertEqual(json.loads(raw), {"pages": [{"title": "中文"}]})
        self.assertEqual(usage["total_tokens"], 20)
        self.assertEqual(len(requests), 1)
        self.assertTrue(requests[0]["stream"])
        self.assertIn("首个流式数据已到达", output.getvalue())
        self.assertIn("思考字段 4 字符", output.getvalue())
        self.assertNotIn("测试思考", output.getvalue())
        self.assertNotIn("fake-key", output.getvalue())

    def test_disconnect_and_missing_finish_stop(self):
        for ending in ([], [chunk(finish="stop")], ["[DONE]"]):
            with self.subTest(ending=ending), streaming_server([chunk('{"pages":[{}]}')] + ending) as (config, requests, _), redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(ModelError, "中断或缺少完成标记"):
                    request_chat(config, [])
                self.assertEqual(len(requests), 1)

    def test_length_stops_without_retry(self):
        with streaming_server([chunk("{", finish="length")]) as (config, requests, _), redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ModelError, "length"):
                request_chat(config, [])
            self.assertEqual(len(requests), 1)

    def test_stream_error_is_redacted(self):
        with streaming_server([{"error": {"message": "bad fake-key"}}]) as (config, requests, _), redirect_stdout(io.StringIO()):
            with self.assertRaises(ModelError) as error:
                request_chat(config, [])
            self.assertNotIn("fake-key", str(error.exception))
            self.assertIn("[redacted]", str(error.exception))
            self.assertEqual(len(requests), 1)


if __name__ == "__main__":
    unittest.main()
