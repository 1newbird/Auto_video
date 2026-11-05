# 运行与目录

Windows x64、Node.js 22+、Python 3.12+。入口为 Skill 根目录 `scripts/paper-lesson.mjs`，可以绝对路径从其他工作目录调用。

Skill 的源码、字体和依赖在本目录 runtime 内，独立于 python_workflow；禁止跨目录引用、软链接共享或自动同步。

## 配置输出

Skill 根目录 settings.json：

```json
{
  "outputDir": "D:/auto_video/output",
  "清晰度": "4K",
  "帧率": 30,
  "_说明": {
    "清晰度": "1080p=1080×1920；1440p=1440×2560；4K=2160×3840，越高越细腻、开销越大。",
    "帧率": "30=常规板书；60=笔移动与圈画更顺滑、开销更大。"
  }
}
```

prepare 默认在该目录内创建短名称 `j-...` 任务，输入文件名不进入任务路径。`--job` 必须位于配置目录内，越界直接拒绝。只有用户明确选择另一输出根目录时，才在各命令传 `--output-dir "指定目录"` 或改配置，不用覆盖参数规避配置。

所有生成文件，包括 `.tmp`、`.cache`、浏览器配置、bundle 和图片，都在输出根目录内。现成字体、浏览器及依赖只读复用；关闭向安装目录写入的构建磁盘缓存。渲染不自动下载浏览器、不复制整个工作目录，缺依赖直接说明。

清晰度与帧率独立选择；旧配置缺少这两项时默认 4K/30。画面使用固定逻辑坐标，纸面、文字、字幕、圈画均按实际输出尺寸栅格化，不放大已有 MP4。60fps 按更密的时间点计算笔动作，讲解时长不变。

修改配置后对已有任务执行 build，会使旧编译失效并重新编译/渲染，复用原 plan.json，无需调用模型。缓存按输出尺寸与帧率隔离，不混用旧画质资产。task.json.video、compile-report.json.video 和 verification.json.video 记录实际参数。临时覆盖可用 --quality 1080p|1440p|4K 与 --fps 30|60；仅用户明确要求时使用，分步命令需保持相同参数。

## 日常命令

以下命令加前缀 `node scripts/paper-lesson.mjs`：

| 命令 | 作用 |
| --- | --- |
| prepare --script 文件 | 原稿存档、分段，返回任务目录，默认用户审核 |
| check --job 目录 | 格式归一、数据检查与实际排版；不生成视频，结果可供 build 复用 |
| build --job 目录 | 一次编译 → 渲染 → 轻量验证，无 LLM 调用或审美审核 |
| compile --job 目录 | 将模型写的 plan.json 编译成布局、时序和字幕 |
| render --job 目录 | 直接输出完整视频，无预览或审阅门槛 |
| verify --job 目录 | 轻量检查编码、尺寸、时长和输入版本 |
| status --job 目录 | 查看阶段、错误和编译状态 |
| preview --job 目录 | 仅用户要求静帧或明确排查时使用 |

流程为 prepare → 主代理写 plan.json → build → 用户审核。check 可单独作为格式/排版工具，不必每次先 check 再 build。build 复用输入与引擎均未改变的编译结果，否则重新编译；compile/check/build 默认将旧任务迁移为 `review-policy=user`。

程序保留原始 plan.json，将确定的格式转换与箭头时间修正写入 output/normalized-plan.json、compile-report.json。错误报告带具体页/元素位置；明确计划问题允许一次集中技术修复，再 build。规则见 [Skill 技术错误处理](../SKILL.md#技术错误处理)，不触发审美返修、全文重编排或环境盲试。

inspect 和 `--review-policy quick|independent` 仅保留历史兼容，只有用户明确要求时才使用。不能因模型自己认为需要而增加审阅，也不能伪造报告。`verify --regression` 用于引擎开发，需先生成对应预览，不用于日常出片。

## 文件

任务目录有 original-script.txt、script.txt、source.json、plan.json、task.json，以及工具临时目录 `.tmp` / `.cache`。任务 `output/` 内有 normalized-plan.json、lesson.json、captions.srt、lesson.mp4、compile-report.json、render-manifest.json、verification.json、bundle 和渲染 `.tmp` / `.cache`。compile-report.json 同时记录成功或失败、自动转换及具体错误；用户要求预览时才生成 page-N.png、frames 等。

板书、字幕和动作按内容复用缓存。字幕合成在内存完成，直接送 FFmpeg，不生成第二套合成 PNG。停止任务后可删除该任务内缓存回收空间，不能误删原稿或运行中的文件。

task.json 保存版本与命令耗时。输入变化需重新 compile，不能复用过期视频。同一任务只有一个写入者，`.running` 锁遗留时先确认进程停止再清理，不复制任务规避。

## 首次安装或缺依赖

doctor 只读诊断。setup 显式安装 runtime/node_modules、runtime/.venv 和浏览器，属于环境安装，不自动运行。已有环境直接使用。Python 可由 PAPER_LESSON_PYTHON 指定，否则优先 runtime/.venv；npm 路径可用 PAPER_LESSON_NPM_CLI 指定。

迁移包包含源码、字体，不含依赖和模型/语音服务。支持无声视频，也支持用户已有音频 + SRT；不生成语音。

有音频时只需改变准备命令，后面仍是一次编排 → build：

```powershell
node scripts/paper-lesson.mjs prepare --script "D:/材料/原稿.md" --audio "D:/材料/音频.mp3" --subtitles "D:/材料/字幕.srt"
node scripts/paper-lesson.mjs build --job "prepare 返回的任务目录"
```

`--subtitles` 接受词级 SRT：文件名 `*.word.srt` 自动直接导入词时间，其他名字加 `--subtitle-level word`。prepare 合并句子并生成 word-timings.json，后续 build 不运行本地声学对齐。无需另外提供句级字幕，不改变音频速度或词时间。

原稿作参考，字幕作为实际口播与段落时间依据；程序保留段间静音，不增加翻页停顿，音频不变速。check/build 优先复用 word-timings.json，仅句级字幕缺少词时间时才补齐本地音文对齐。每个圈画/下划线需提供明确 quote；模型选择重点，程序让实际落笔对准该词。需要本地对齐时，首次组件及模型下载全部位于 outputDir/.paper-lesson-align，不上传素材，不改 Python 工作流。导入已有词级数据、重新对齐和当前输入限制见 [词级对齐](word-alignment.md)。
