# 给 AI 的上手指南

用户要生成视频时，先确认素材目录、输出目录和运行环境。以下步骤针对 `skills/paper-lesson/`。当前发布版已在 **Windows x64** 验证，**macOS 需要在目标机器上适配并试片**。

## 用户要准备什么

| 用户想做什么 | 需要的文件 | AI 如何处理 |
| --- | --- | --- |
| 无声板书 | 一份 UTF-8 原稿，`.md` 或 `.txt` | 按原文估计时长，生成板书和字幕。 |
| 已有配音，提供句级字幕 | 原稿、最终音频、与这版录音配套的句级 `.srt` | 保留每句的时间。首次 build 时按需下载本地对齐组件与模型，在句内定位圈画用的关键词。 |
| 已有配音，希望圈画跟词走 | 原稿、最终音频、带真实字词起止时间的 `.word.srt` | 直接用提供的词时间，按短句显示字幕，圈画在关键词起点落笔。 |

例如，同一目录里有 `讲稿.md`、`旁白.mp3`、`旁白.word.srt`，就具备词级有声输入。**只需要一份 SRT**。其他名字的词级文件在 prepare 时加 `--subtitle-level word`。判断粒度要看每条时间对应的是一句话还是一个字词，仅修改后缀不会产生新的时间信息。

先读目录并匹配文件。录音有多个版本或缺少素材时，只问用户要用哪一版或补哪个文件。口播顺序、字幕与时间以最终录音对应的 SRT 为准。原始 Markdown 用来理解内容和参考标题、表格、图解，交给 Codex 做一次编排。Skill 本身无需单独的模型 API Key。

## 从安装到出片

1. 在准备实际调用的 Skill 目录里操作。Windows x64 需要 Node.js 22+（含 npm）和 Python 3.12+。首次从 [settings.example.json](settings.example.json) 复制出 `settings.json`，已有配置就沿用。把 `outputDir` 改成用户选定的、Skill 目录以外的可写绝对路径。默认 4K、30fps。安装依赖放在 Skill 的 `runtime/`，任务、成片和渲染临时文件放在 `outputDir`。
2. 新装环境按 [README](README.md) 运行 `node scripts/paper-lesson.mjs setup` 和 `node scripts/paper-lesson.mjs doctor`。已有可用安装直接制作。Mac 先完成下一节适配，再运行这两个命令。
3. 以下命令在 Skill 目录执行。按用户实际素材**只选一条**，把引号中的示例替换为绝对路径。

```text
node scripts/paper-lesson.mjs prepare --script "<原稿.md>"
node scripts/paper-lesson.mjs prepare --script "<原稿.md>" --audio "<旁白.mp3>" --subtitles "<句级字幕.srt>" --subtitle-level cue
node scripts/paper-lesson.mjs prepare --script "<原稿.md>" --audio "<旁白.mp3>" --subtitles "<词级字幕.srt>" --subtitle-level word
```

4. 使用 prepare 输出的任务目录。Codex 按 [SKILL.md](SKILL.md) 和 [计划接口](references/plan-interface.md) 读取任务里的 `source.json` 与 `original-script.txt`，在同目录写入 `plan.json`。需要圈画时把目标绑定到实际台词中的 `segment` 与 `quote`。
5. 执行 `node scripts/paper-lesson.mjs build --job "<prepare 返回的任务目录>"`。成功后交付任务中的 `output/lesson.mp4`，由用户审核。再次调整画面时修改同一份计划，复用音频和时间戳。

## 在目标 Mac 上适配

先从 Skill 目录运行 `uname -m`、`node -p "process.platform + ' ' + process.arch"`、`node -v`、`npm -v` 和 `python3 --version`。记录 Node 实际运行的是 `darwin arm64` 还是 `darwin x64`，尤其留意使用 Rosetta 的机器。以下是 v0.3.9 源码中的修改位置。只适配本 Skill，并保留 Windows 分支。

| 从哪里改 | 在 Mac 上要做到什么 |
| --- | --- |
| [安装和环境检查](scripts/paper-lesson.mjs) | 让 setup 与 doctor 接受已适配的 Darwin 架构。从本机调用 npm，用 Python 3.12+ 建立 `runtime/.venv`，选择 `bin/python`。从 runtime 锁文件安装依赖并准备浏览器，让 doctor 检查实际安装的可执行文件。 |
| [浏览器启动](runtime/scripts/render-lesson.mjs) | 将固定的 `win64/…exe` 改为本机已安装的 Remotion Chromium 路径。setup、doctor 和渲染应找到同一个可执行文件，实际启动并渲染。 |
| [音频探测与合成](runtime/scripts/lib/audio.mjs)、[视频编码](runtime/scripts/lib/state-renderer.mjs)、[成片验证](runtime/scripts/verify-lesson.mjs) | 锁文件列有 `@remotion/compositor-darwin-arm64` 和 `@remotion/compositor-darwin-x64`。按 Node 实际架构查找已安装包里的 FFmpeg、ffprobe，验证文件名与执行权限；探测、编码、合入音轨和验证都使用该平台的工具。片段验证另查 [verify-clip.mjs](runtime/scripts/verify-clip.mjs) 与 [clip_qa.py](runtime/scripts/clip_qa.py)。 |
| [字幕绘制](runtime/src/PaperLesson.tsx)、[字幕缓存](runtime/scripts/lib/state-renderer.mjs) | 板书使用自带的寒蝉手拙体。为字幕选一款本机 Chromium 能加载的中文字体，将其纳入缓存签名，检查中文、数字、英文的实际画面。开发回归图用的 Windows 字体路径见 [lesson_qa.py](runtime/scripts/lesson_qa.py)。 |
| [对齐环境](scripts/alignment.mjs)、[录音解码](runtime/scripts/align_words.py) | 词级 SRT 可直接跳到试片。需要句级 SRT 时，再适配对齐环境的 `venv/bin/python` 和解码用的 FFmpeg，验证锁定的对齐组件可在该机器运行。组件、模型及下载临时文件均放在 `outputDir/.paper-lesson-align/`。 |

Mac 的 `outputDir` 用实际挂载路径，例如外置卷上的 `/Volumes/Media/板书输出`。按 [存储逻辑](scripts/storage.mjs) 检查任务与渲染缓存实际落在指定目录。不同机器的用户名、卷名和工具路径由本机确定。

## 怎样确认适配完成

在目标 Mac 上用一套独立的短素材走正常入口，例如 5–10 秒的中文录音、同内容的原稿和匹配的词级 SRT。在 plan 里安排一次与台词对应的圈或下划线，按上文 prepare、编排、build 完成整段短片。

打开 `output/lesson.mp4`，确认听得到原音频、看得到中文字幕、说到关键词时出现圈画。核对 `output/verification.json` 的结果、分辨率和帧率。记录该机器的架构、实际测试的 SRT 粒度和成片路径。要声明句级输入也能使用，还需用真实句级 SRT 单独跑通本地对齐和 build。

下载后可以直接对 Codex 说：“请读 `skills/paper-lesson/AI_SETUP.md`。我的素材在【素材目录】，输出放在【输出目录】。先告诉我文件是否齐全；如果是 Mac，请只适配这个 Skill，并在这台机器上生成一段有声样片。”
