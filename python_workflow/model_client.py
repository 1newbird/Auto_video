"""One HTTP request, no agent, tools, automatic retry or visual review."""
import json
import http.client
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


class ModelError(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    # Never forward an Authorization header to a redirected host.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def model_settings(config):
    name = str(config.get("name") or "").strip()
    key = str(config.get("api_key") or os.environ.get("LLM_API_KEY", "")).strip()
    base = str(config.get("base_url") or "").strip().rstrip("/")
    if not name or not key or not base:
        raise ModelError("请填写 config.yaml 的 model.base_url、name、api_key（或 LLM_API_KEY）。")
    if not base.startswith(("https://", "http://")):
        raise ModelError("model.base_url 必须是 http:// 或 https:// 地址。")
    return name, key, base


def generate_plan(config, prompt, source, previous=None, feedback=""):
    data = {"source": source}
    if feedback:
        data.update(previous_plan=previous, feedback=feedback)
    return request_chat(config, [
        {"role": "system", "content": prompt},
        {"role": "user", "content": json.dumps(data, ensure_ascii=False)},
    ])


class RequestProgress:
    """Show real elapsed waiting time without making additional requests."""
    def __init__(self, key):
        self.key = key
        self.started = time.monotonic()
        self.stage = "连接服务 / 等待响应头"
        self.chunks = 0
        self.content_chars = 0
        self.reasoning_chars = 0
        self.last_received = None
        self.last_report = self.started
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self._heartbeat, daemon=True)

    def log(self, message):
        elapsed = time.monotonic() - self.started
        print(f"[模型 {elapsed:.1f}s] {message}".replace(self.key, "[redacted]"), flush=True)

    def _heartbeat(self):
        while not self.stopped.wait(5):
            self.log(f"仍在等待：{self.stage}；{self.counts()}（Ctrl+C 可中止）")

    def counts(self):
        gap = "" if self.last_received is None else f"；距上次数据 {time.monotonic() - self.last_received:.1f}s"
        return f"已收 {self.chunks} 个数据事件，正文 {self.content_chars} 字符，思考字段 {self.reasoning_chars} 字符{gap}"

    def received(self, content, reasoning):
        self.chunks += 1
        self.last_received = time.monotonic()
        if self.chunks == 1:
            self.log("首个流式数据已到达")
        first_content = bool(content) and self.content_chars == 0
        first_reasoning = bool(reasoning) and self.reasoning_chars == 0
        self.content_chars += len(content)
        self.reasoning_chars += len(reasoning)
        if content:
            self.stage = "接收计划正文"
        elif reasoning:
            self.stage = "接收思考字段，等待计划正文"
        if first_content or first_reasoning or self.last_received - self.last_report >= 1:
            self.log(f"{self.stage}；{self.counts()}")
            self.last_report = self.last_received

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.stopped.set()
        self.thread.join()


def read_stream(response, progress):
    """Read SSE events incrementally; never pass an unfinished plan to rendering."""
    parts, event_lines = [], []
    usage, finish_reason = {}, None
    done = False
    for line_bytes in response:
        line = line_bytes.decode("utf-8").rstrip("\r\n")
        if line:
            if line.startswith("data:"):
                event_lines.append(line[5:].removeprefix(" "))
            continue  # SSE comments and other fields do not contain model output.
        if not event_lines:
            continue
        event_text = "\n".join(event_lines)
        event_lines.clear()
        if event_text == "[DONE]":
            done = True
            break
        event = json.loads(event_text)
        if not isinstance(event, dict):
            raise ModelError("流式响应格式错误：事件必须是 JSON 对象。未自动重试。")
        if event.get("error"):
            detail = json.dumps(event["error"], ensure_ascii=False).replace(progress.key, "[redacted]")
            raise ModelError(f"模型流式请求失败：{detail}。未自动重试。")
        if isinstance(event.get("usage"), dict):
            usage = event["usage"]
        choices = event.get("choices") or []
        if not isinstance(choices, list):
            raise ModelError("流式响应 choices 格式错误。未自动重试。")
        content, reasoning = "", ""
        for choice in choices:
            if not isinstance(choice, dict):
                raise ModelError("流式响应 choice 格式错误。未自动重试。")
            if choice.get("index", 0) != 0:
                continue
            delta = choice.get("delta") or {}
            if not isinstance(delta, dict):
                raise ModelError("流式响应 delta 格式错误。未自动重试。")
            content = delta.get("content") or ""
            reasoning = delta.get("reasoning_content") or delta.get("reasoning") or ""
            if not isinstance(content, str) or not isinstance(reasoning, str):
                raise ModelError("流式响应正文或思考字段不是文本。未自动重试。")
            if content:
                parts.append(content)
            if choice.get("finish_reason"):
                finish_reason = choice["finish_reason"]
                if finish_reason != "stop":
                    raise ModelError(f"模型未完整输出：{finish_reason}。未渲染，未自动重试。")
        progress.received(content, reasoning)
    if not done or finish_reason != "stop":
        raise ModelError(f"模型流式响应中断或缺少完成标记（finish_reason={finish_reason}，DONE={done}；{progress.counts()}）。未渲染，未自动重试。")
    progress.log(f"流式接收完成；{progress.counts()}")
    return {"choices": [{"message": {"content": "".join(parts)}, "finish_reason": finish_reason}], "usage": usage}


def request_chat(config, messages):
    """Shared transport for the workflow and the standalone connectivity test."""
    name, key, base = model_settings(config)
    timeout = float(config.get("timeout_seconds", 180))
    if timeout <= 0:
        raise ModelError("timeout_seconds 必须大于 0。")
    payload = {"model": name, "stream": True, "messages": messages}
    if config.get("json_mode", True):
        payload["response_format"] = {"type": "json_object"}
    endpoint = base if base.endswith("/chat/completions") else base + "/chat/completions"
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(endpoint, data=body,
                                     headers={"Authorization": "Bearer " + key,
                                              "Content-Type": "application/json",
                                              "Accept": "text/event-stream"})
    with RequestProgress(key) as progress:
        url = urllib.parse.urlsplit(endpoint)
        safe_url = urllib.parse.urlunsplit((url.scheme, url.netloc.rsplit("@", 1)[-1], url.path, "", ""))
        progress.log(f"POST {safe_url}")
        progress.log(f"模型={name}；stream=True；请求={len(body)} 字节；网络超时={timeout:g}s；JSON mode={bool(config.get('json_mode', True))}")
        try:
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout) as response:
                progress.log(f"已收到 HTTP {response.status}")
                if "text/event-stream" in response.headers.get("Content-Type", "").lower():
                    progress.stage = "流连接已建立，等待首个数据"
                    result = read_stream(response, progress)
                else:
                    progress.stage = "服务未返回 SSE，接收普通 JSON 响应"
                    progress.log(progress.stage + "（本次仍只有一个请求）")
                    response_body = response.read()
                    progress.log(f"正文接收完成：{len(response_body)} 字节，解析 JSON")
                    result = json.loads(response_body)
        except urllib.error.HTTPError as exc:
            progress.log(f"服务返回 HTTP {exc.code}")
            try:
                detail = exc.read(1600).decode("utf-8", errors="replace")
            except (OSError, urllib.error.URLError):
                detail = "错误响应正文读取失败"
            detail = detail.replace(key, "[redacted]")
            raise ModelError(f"模型请求失败 HTTP {exc.code}: {detail}。未自动重试。") from None
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException) as exc:
            raise ModelError(f"模型连接或读取失败（{time.monotonic() - progress.started:.1f}s，{progress.stage}）：{str(exc).replace(key, '[redacted]')}。检查地址、网络/代理及 timeout_seconds；未自动重试。") from None
        except (ValueError, UnicodeError):
            raise ModelError("服务返回的响应不是有效 JSON；请检查服务地址是否为模型 API，以及代理是否返回了网页。未自动重试。") from None
    try:
        choice = result["choices"][0]
        if choice.get("finish_reason") in ("length", "content_filter"):
            raise ModelError(f"模型未完整输出：{choice['finish_reason']}。未渲染，未自动重试。")
        raw = choice["message"]["content"]
        if not isinstance(raw, str) or not raw.strip():
            raise ModelError("模型没有返回文本内容。未自动重试。")
    except (KeyError, IndexError, TypeError):
        raise ModelError("服务未返回 Chat Completions 格式的 choices[0].message.content。") from None
    progress.log(f"调用成功：返回 {len(raw)} 字符；finish_reason={choice.get('finish_reason')}；usage={json.dumps(result.get('usage', {}), ensure_ascii=False)}")
    return raw, result.get("usage", {})


def parse_plan(raw):
    text = raw.strip()
    if text.startswith("```") and text.endswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    try:
        plan = json.loads(text)
    except (ValueError, IndexError):
        raise ModelError("模型输出不是有效 JSON；原始输出已保存为 model-output.txt。未自动返修。") from None
    if not isinstance(plan, dict) or not isinstance(plan.get("pages"), list) or not plan["pages"]:
        raise ModelError("模型计划需要非空 pages 数组。未自动返修。")
    return plan
