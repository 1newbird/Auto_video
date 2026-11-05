"""Run in an IDE to test config.yaml's model without reading a manuscript or rendering."""
import argparse
from pathlib import Path
import sys
import time

sys.dont_write_bytecode = True
from main import HERE, load_config, resolved_path
from model_client import model_settings, request_chat
from history import RunRecord


def main():
    parser = argparse.ArgumentParser(description="只发送一次短请求，测试模型连接；不生成视频")
    parser.add_argument("--config", type=Path, default=HERE / "config.yaml")
    parser.add_argument("--timeout", type=float, default=60, help="测试网络超时秒数，默认 60；不修改 YAML")
    args = parser.parse_args()
    started = time.monotonic()
    try:
        print(f"[测试] 读取配置：{args.config.resolve()}", flush=True)
        settings = load_config(args.config)
        config = dict(settings["model"])
        config["timeout_seconds"] = args.timeout
        _, key, _ = model_settings(config)
        output = resolved_path(settings["output_dir"], args.config.resolve().parent)
        with RunRecord(output / "model-tests", key) as record:
            record.update(kind="model_test", model_requests=1)
            print("[测试] 发送一次流式短请求，沿用配置的模型、Key 和 JSON mode", flush=True)
            raw, usage = request_chat(config, [
                {"role": "user", "content": '这是 API 连通性测试，请只返回 JSON：{"ok":true}，无需解释。'},
            ])
            (record.path / "reply.txt").write_text(raw.replace(key, "[redacted]"), encoding="utf-8")
            record.succeed({"status": "success", "model_requests": 1, "usage": usage, "total_seconds": round(time.monotonic() - started, 2)})
            print(f"[测试成功] 模型已返回文本，总耗时 {time.monotonic() - started:.1f}s；记录：{record.path}", flush=True)
            print("返回内容：" + raw[:2000].replace(key, "[redacted]"), flush=True)
        return 0
    except KeyboardInterrupt:
        print("[测试] 已手动中止。", flush=True)
        return 130
    except Exception as exc:
        print(f"[测试失败] {time.monotonic() - started:.1f}s：{exc}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
