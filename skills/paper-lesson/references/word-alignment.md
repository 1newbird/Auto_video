# 词级落笔同步

用户只需原稿、音频、SRT。词级 SRT 直接提供时间；句级 SRT 才由 check/build 完成本地音文对齐。结果均保存为 word-timings.json，不增加聊天模型编排或审美步骤，修改画面时复用。

## 词级 SRT 直接输入

prepare 的 `--subtitles` 可直接传 `*.word.srt`，按文件名自动选择词级。其他文件名追加 `--subtitle-level word`；`auto` 为默认，`cue` 可显式按句级处理。该选项只说明输入粒度，不会把句级数据变成词级。

程序将中文单字和英文片段按原顺序拼接，按句末标点或至少 0.8 秒停顿分段；保留全部给定起止时间，原文空格不凭空推断。`SKILL.md` 内的点不会拆成新句。独立 `(breath)` 等已知标记不显示，音频及停顿不裁剪。字幕显示为短句，圈画读取原始字词时间，并非逐字闪烁字幕。

prepare 同时输出 source.json 和 word-timings.json，原 SRT 完整保存为 original-subtitles.srt。后续 check/build 直接复用；时间文件缺失或 `align --refresh` 时从保存的词级 SRT 重建，不启动声学环境。字幕与 Markdown 不一致时保留并报告差异，不自动删字改稿。词时间是否准确对应实际录音仍由用户听看确认。

模型负责每个强调动作的 segment、target 和 quote。quote 必须是对应口播里唯一出现的词/短语；板书可以概括，quote 必须照抄实际台词。程序从 quote 覆盖的字词起点确定 activeStart（实际落笔），提前约 0.2 秒安排笔的移动，绘制时间按词组长度和可用空间限制。短字幕切换也读取词级结果，保留原 SRT 起止及停顿。原有音频模式的 duration/offset/unitsPerSecond 不作为时间来源。

在同一时刻强调多个对象，应合并成一个目标或将部分改为红字；工具不会为了单支笔避让而把重点词对应的落笔挪到下一句。compile-report.json 的 anchors 列出关键词秒数、进场秒数、落笔秒数与 errorFrames，方便定位用户反馈。

## 工具

命令前缀是 `node "Skill根目录/scripts/paper-lesson.mjs"`。

- `align --job "任务目录"`：缺少结果时对齐，有有效结果时直接复用。
- `align --job "任务目录" --refresh`：用户明确要重做对齐时使用；不默认每次重跑。
- `align --job "任务目录" --words "JSON绝对路径"`：导入已经有的词级数据或用户纠正过的结果，不运行本地声学模型。
- `build --job "任务目录"`：复用词级结果和语义计划出片。

导入 JSON 使用以下格式；start/end 是相对于该段文字的 JavaScript UTF-16 索引，startSeconds/endSeconds 是整段音频的绝对秒数。所有段落按 source.json 完整提供，允许标点时间长度为零，不能把未对齐的重点词伪造为等距时间。音频、文本、SRT 时间变化会拒绝旧结果，需重新对齐。

```json
{
  "schemaVersion": 1,
  "sourceHash": "source.json 的 sha256",
  "audioHash": "source.json 的 audio.sha256",
  "cueTimes": [["s001", 0, 2]],
  "method": "provided-word-timestamps",
  "segments": {
    "s001": [
      {"text":"重点", "start":0, "end":2, "startSeconds":0.5, "endSeconds":1.2},
      {"text":"。", "start":2, "end":3, "startSeconds":1.2, "endSeconds":1.2}
    ]
  }
}
```

词级 SRT 已自动转换；其他平台 JSON 导出须按真实字段转换成此格式，不猜测毫秒/秒或音频版本。标准 JSON 导入仍需与当前 source.json 分段对应。

## 本地依赖与限制

固定使用 faster-whisper 1.2.1 / CTranslate2 的文本音频 align 接口与 small 多语模型，CPU int8，不调用 transcribe，不生成或改写稿件。实现依据：[CTranslate2 align 接口](https://opennmt.net/CTranslate2/python/ctranslate2.models.Whisper.html#ctranslate2.models.Whisper.align)、[faster-whisper 对齐实现](https://github.com/SYSTRAN/faster-whisper/blob/v1.2.1/faster_whisper/transcribe.py)。

组件、模型、下载临时文件位于 outputDir/.paper-lesson-align，独立于 Python 工作流；代码仍只读本 Skill 目录。首次需联网下载公开依赖和约 0.5 GB 模型，后续可本地复用。没有 API Key，也不上传用户音频。模型文件是长期复用资源，不能当每次渲染缓存自动清除。

本地声学对齐按每条句级 SRT 限定音频窗口，单条需短于约 30 秒；直接导入词级时间不受这个窗口限制。超长句级字幕应提供更细的真实时间范围或已有词级结果，不能用字数比例冒充对齐。混合语言、缩写和非口播标记可能影响准确度；工具报告无法定位/零时长关键词，不能宣称所有词经过人工确认。用户听到明显偏移时，先定位该 quote 的词级数据并局部纠正，再 build，不重新编排全文。
