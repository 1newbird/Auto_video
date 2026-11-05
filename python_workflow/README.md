# Python 板书视频工作流

将 Markdown 原稿制作成竖屏白纸板书视频。可以提供现成配音和 SRT，让文字、流程图和圈画随台词出现。模型负责一次内容编排，固定程序负责排版、时间线及 MP4 渲染，最终效果由使用者审核。

本目录是独立项目，渲染器、字体和脚本都在 `runtime/` 内，不依赖其他目录或 Skill。Git 仅包含源码、必要资源和回归测试，不含安装依赖、下载的模型、真实配置、私人稿件或生成的视频。

## 功能

- Chat Completions 兼容接口，流式显示请求状态，不自动进行多轮审美审阅或模型返修。
- 层级文字、流程图、红字、圈画；空间不足时适度缩放，必要时按安全内容边界拆页。
- 竖屏 1080p / 1440p / 4K，30 / 60 fps。
- 句级或词级 SRT 同步；词级输入无需声学模型。
- 可关闭画面字幕，保留声音、同步和独立 SRT，方便后期剪辑。
- 历史分版、计划复用；成功后默认清理渲染图片缓存。

## 环境与安装

当前实现面向 **Windows x64、Python 3.12、Node.js 22.6+**，使用 Windows 版 Chromium、FFmpeg 和系统字体，尚未适配 Linux/macOS。以下 PowerShell 命令从仓库根目录开始：

```powershell
cd python_workflow
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt -r runtime/requirements.txt
npm ci --prefix runtime
Push-Location runtime
npx remotion browser ensure
Pop-Location
Copy-Item example.yaml config.yaml
```

`npm ci` 安装锁定的渲染依赖及配套 FFmpeg；浏览器仅在显式安装步骤下载。虚拟环境、依赖和浏览器体积较大，不随 Git 上传，换电脑时重建。

## 首次运行

1. 自行创建 `input.md`，或把配置中的 `input_file` 指向已有 UTF-8 Markdown。
2. 配置 `output_dir`。路径可用正斜杠；相对路径以配置文件所在目录为准。
3. 填写 `model.base_url` 和 `model.name`。前者是接口服务前缀，程序补上 `/chat/completions`，不是网页聊天地址。
4. 设置 API Key 并运行：

```powershell
$env:LLM_API_KEY = "替换为你的 API Key"
.venv/Scripts/python.exe test_model.py
.venv/Scripts/python.exe main.py
```

也可以在 IDE 选择 `.venv` 解释器直接运行 `main.py`。真实配置用本地 `config.yaml`，已被 Git 忽略；仓库只提供 [example.yaml](example.yaml)。不要把真实 Key 提交到仓库。

`test_model.py` 发一次短请求，记录在输出目录 `model-tests/`，会调用配置的服务并可能产生费用。短请求成功不保证长稿编排成功。正式调用显示响应状态、事件数、正文及思考字符数，思考内容不打印；断流或截断会停止，不自动重试。

## 现成音频与字幕

```yaml
input_file: "inputs/script.md"
audio_file: "inputs/narration.mp3"
subtitle_file: "inputs/narration.word.srt"
关键词同步: true
```

音频和 SRT 必须配套；两项一起留空则生成无声视频。程序不生成配音，不把录音上传到编排服务，模型接收文本。SRT 决定实际台词及时间，Markdown 供理解内容和参考结构，不要求照搬排版。

- 词级 SRT 使用 `.word.srt` 后缀，支持中文单字、英文片段及独立呼吸标记，直接导入词时间。不要把句级字幕仅改名冒充词级。
- 普通 `.srt` 使用句级时间。关闭 `关键词同步` 可直接出片；开启时需安装下面的可选声学对齐组件。
- 重复片段整理：只在 Markdown 局部上下文唯一确认时合并相邻重复数字/英文及英文尾字母残留。保留完整时间区间；正常中文叠词和未确认差异不改。`subtitle-normalization.json` 留痕，原 SRT 保留。

圈画使用词时间，短字幕切换仍按句内文字比例划分。时间重叠、越界会报错；无法定位或安排的强调记录在 `gesture-sync.json`，不保证所有输入都能自动修正。

仅普通句级字幕且需要词级圈画时，安装可选依赖：

```powershell
.venv/Scripts/python.exe -m pip install torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu
.venv/Scripts/python.exe -m pip install -r requirements-alignment.txt
.venv/Scripts/python.exe setup_alignment.py
```

这会下载较大的依赖和模型到 `runtime/models/`。词级 SRT 用户无需安装；声学对齐存在误差，需听看确认。

## 画质与画面字幕

```yaml
视频:
  清晰度: "4K"  # 1080p=1080×1920；1440p=1440×2560；4K=2160×3840
  帧率: 30      # 30 或 60
显示字幕: false
```

`显示字幕` 默认 true，将字幕画进视频；false 输出无字幕画面，但保留声音、圈画同步、`captions.srt` 和底部留白。更改配置不会修改已有 MP4，需要重新渲染。

4K 长片采用 CPU 编码，可能比视频本身时长更久；60fps 增加帧数。编码阶段目前没有连续百分比进度，控制台暂不更新不一定代表进程卡住。

## 复用计划和修改内容

```yaml
复用计划: "output/runs/某次编号/plan.json"
feedback: ""
```

填写 `复用计划` 后运行可跳过模型，适用于修改画质、字幕开关或重试渲染。命令行也可指定：

```powershell
.venv/Scripts/python.exe main.py --config config.yaml --plan "output/runs/某次编号/plan.json"
```

输入必须匹配；其他原稿会被拒绝。若差异仅为本次已确认的词级字幕整理，可沿用旧段号及画面计划，记录在 `plan-source-update.json`。安全拆页记录在 `layout-adjustments.json`，原模型计划保留。

需要模型改内容时，清空 `复用计划` 并填写 `feedback`，对同一原稿的上次计划进行一次编排。新稿清空这两个字段。提示词在 `prompt.txt`。

## 输出与存储

```text
output/
  runs/<时间编号>/   # MP4、输入快照、plan.json、lesson.json、SRT、日志和报告
  .work/            # 图片缓存、构建、临时目录及对齐缓存
  latest-run.json
  latest-success.json
```

每次运行单独保存，不覆盖旧成片。`保留渲染中间文件: false` 默认成功后清理当前任务图片、构建和临时目录；true 保留用于排错或再次渲染。失败保留现场。历史视频、输入、计划和其他任务不会被清理；渲染期间仍需足够磁盘空间。

## 代码结构与测试

```text
main.py                    # 配置、历史、编排、渲染与音频合入
model_client.py            # 流式模型调用
audio_inputs.py           # 音频/SRT 导入
subtitle_normalization.py  # 有原稿依据的片段整理
prompt.txt                 # 一次编排的规则
runtime/src/               # 板书、字幕、笔动作画面
runtime/scripts/           # 排版、编译、缓存及编码
runtime/public/fonts/      # 必要字体、作者说明与来源
tests/                    # Python 单元测试及最小回归样例
runtime/tests/             # 排版、时间线、缓存和画质测试
```

测试不请求真实编排服务；部分 Python 测试使用本机模拟 HTTP 服务或 FFmpeg，需先安装基础依赖。

```powershell
.venv/Scripts/python.exe -B -m unittest discover -s tests -p "test_*.py"
$env:PAPER_LESSON_PYTHON = (Resolve-Path .venv/Scripts/python.exe).Path
Push-Location runtime
npm test
npm run typecheck
Pop-Location
```

字体为寒蝉字型的 **寒蝉手拙体（ChillZhuo）**，作者说明及来源保存在 `runtime/public/fonts/`。第三方依赖遵循各自许可；本项目未替其授予额外权利。
