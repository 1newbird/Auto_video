# 上手指南：准备素材，在本机运行 Python 工作流

下载仓库后，先让 AI 阅读本页和同目录的 [README](README.md)。Windows x64 用户按 README 安装即可。macOS 用户需要完成下文的代码适配，并在自己的 Mac 上导出短片。当前发布版的验证环境为 Windows x64。

## 先准备哪些文件

| 想做的视频 | 用户提供 | 在 config.yaml 中填写 |
| --- | --- | --- |
| 无声板书 | UTF-8 Markdown 原稿 | `input_file` 指向原稿，`audio_file` 和 `subtitle_file` 都留空 |
| 有声，按句同步 | 原稿、最终配音、这段配音对应的普通 `.srt` | 填入三个路径，`关键词同步: false`，按句出片 |
| 有声，圈画跟具体词走 | 原稿、最终配音、含真实字词起止时间的 `.word.srt` | 填入三个路径，`关键词同步: true`，直接读取词时间 |

如果手上只有句级 SRT 又需要词级圈画，可按 README 安装可选本地对齐组件；优先用上表的按句模式验证基础环境。词级文件的后缀只是导入标记，文件内容应实际包含字词时间。所有有声模式都要求字幕与最终录音配套。

在 `python_workflow/` 中复制 [example.yaml](example.yaml) 为 `config.yaml`，已有个人配置时直接编辑。下面的字段可以作为词级输入示例，其余字段沿用模板。

```yaml
input_file: "inputs/script.md"
audio_file: "inputs/narration.mp3"
subtitle_file: "inputs/narration.word.srt"
output_dir: "output"
关键词同步: true
显示字幕: false
```

相对路径按配置文件所在目录解析。关闭画面字幕仍会读取输入 SRT，并导出 `captions.srt`。新稿编排需要模型服务前缀、模型名和本机的 `LLM_API_KEY`。已有匹配的计划可以用 `--plan` 跳过模型；API Key 由用户在本机设置。

## 在 Mac 上适配（给执行修改的 AI）

1. 从 `python_workflow/` 开始，执行 `uname -m`、`node -p "process.platform + ' ' + process.arch"`、`python3.12 --version` 和 `node -v`。确认 Apple Silicon 或 Intel 以及实际运行的 Node 架构，尤其要留意 Rosetta。按 README 的 Python 3.12 和 Node 版本要求准备环境。
2. 用 Mac 的 Python 建立虚拟环境，并按锁文件安装依赖。以下命令只完成准备，后续仍要修改程序中的平台路径。

   ```sh
   python3.12 -m venv .venv
   .venv/bin/python -m pip install -r requirements.txt -r runtime/requirements.txt
   npm ci --prefix runtime
   (cd runtime && npx remotion browser ensure)
   export PAPER_LESSON_PYTHON="$PWD/.venv/bin/python"
   ```

3. 从下表定位代码。保留 Windows 分支，按操作系统和架构选择实际安装的工具，分别在 Python 和 Node 的调用处使用。调整后搜索剩余的 `win32-x64-msvc`、`win64`、`.exe` 和 `Microsoft YaHei`，并检查相关测试。

   | 位置 | Mac 需要实现或验证的行为 |
   | --- | --- |
   | `main.py`、`audio_inputs.py` | 使用当前虚拟环境的 Python。解析本机可执行的 FFmpeg 和 ffprobe，供探测音频、编码及合入音轨使用。 |
   | `runtime/scripts/render-lesson.mjs` | 将写死的 Windows Chrome 路径改为取得本机 Chromium 路径，验证浏览器能够启动并渲染静帧。可参考 [Remotion 浏览器 API](https://www.remotion.dev/docs/renderer/ensure-browser)。 |
   | `runtime/scripts/lib/state-renderer.mjs`、`runtime/scripts/verify-*.mjs`、`runtime/scripts/clip_qa.py` | 锁文件列有 `@remotion/compositor-darwin-arm64` 和 `@remotion/compositor-darwin-x64`。按实际架构检查装好的包、工具名称及执行权限，覆盖主渲染和验证脚本中的硬编码。 |
   | `runtime/src/PaperLesson.tsx`、`runtime/scripts/lib/state-renderer.mjs` | 为中文**字幕**选择本机可用字体，缓存签名跟随字体；板书继续使用项目附带的寒蝉手拙体。检查中文、数字和英文是否正常显示。 |
   | `history.py`、`render_storage.py` | 任务锁已有 POSIX 的 `fcntl` 分支，验证同时运行互斥、退出后释放。验证 Mac 上的缓存清理和符号链接保护。 |

## 在目标 Mac 上怎样算跑通

先用仓库配套的无声样例验证排版和编码。准备一份单独的 `smoke.yaml`，从模板复制，将 `input_file` 设为 `tests/fixtures/quality-history/source.md`，将两个音频字段留空，端到端走正常入口：

```sh
.venv/bin/python main.py --config smoke.yaml --plan tests/fixtures/quality-history/plan.json
```

然后用几秒钟的中文录音、相同内容的 Markdown 和与录音匹配的 SRT 验证有声链路。第一次选普通 SRT、`关键词同步: false`，准备对应这几秒台词和分段的本地测试计划。编码完成后用 ffprobe 检查输出含视频流和音频流，播放确认中文可读、声音可听、字幕与台词同段出现，再检查独立 `captions.srt`。用户实际使用词级输入时，再用其 `.word.srt` 核对一次关键词落笔。验收记录应写明 Mac 架构、实际运行的命令和短片路径。

## 可直接发给 AI

> 请先阅读 python_workflow/AI_SETUP.md 和 README.md，检查我的系统、架构、Python、Node 和输入文件。按我的字幕类型选择依赖，并从 example.yaml 准备本地配置。如果是 Mac，请按指南逐项适配，只改 python_workflow，在这台 Mac 上用本地计划跑通短样片。完成后告诉我哪些配置需要我填写、样片在哪里，以及正式生成该运行哪条命令。
