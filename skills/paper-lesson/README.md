# paper-lesson

将中文稿件制作成竖屏白纸板书视频的 Codex Skill。当前渲染器版本为 **v0.3.9**。

模型负责一次内容编排，固定程序负责排版、字幕、圈画时间与视频渲染，成片由用户审核。支持纯文字无声视频，也支持原稿 + 现成音频 + 句级或词级 SRT；不生成配音，不需要为 Skill 单独配置模型 API Key。

## 安装与配置

当前支持 **Windows x64、Node.js 22+、Python 3.12+**。

在本目录打开 PowerShell，首次配置并安装依赖：

```powershell
Copy-Item -LiteralPath .\settings.example.json -Destination .\settings.json
# 先编辑 settings.json，设置自己的输出目录，再安装依赖。
node scripts/paper-lesson.mjs setup
node scripts/paper-lesson.mjs doctor
```

已有 `settings.json` 时保留自己的配置，无需重复复制。`setup` 需要联网，依赖、Python 虚拟环境和浏览器安装在本 Skill 的 `runtime/` 内；日常制作不重复运行 setup 或 doctor。

`settings.json` 不纳入 Git。默认画质为 4K（2160×3840）、30fps，可选 1080p / 1440p / 4K 和 30 / 60fps。任务、缓存、临时文件、字幕及成片全部写入 `outputDir`；将它设置为有足够空间的目录，且必须在 Skill 目录之外。

可以直接在 Codex 中引用本目录 `SKILL.md` 的绝对路径。要用 `$paper-lesson` 名称调用，可先将整个 `paper-lesson` 文件夹安装到自己的 Codex skills 目录，再在安装位置完成上述配置和依赖安装；已有安装的用户无需重新安装一套依赖。

## 使用

将下面示例中的路径换成自己的实际路径：

```text
使用 D:\Auto_video\skills\paper-lesson\SKILL.md，
将 D:\素材\本期视频 中的 Markdown 原稿、音频和词级 SRT 制作成完整板书视频。
按 settings.json 的输出路径和画质生成，圈画与对应台词同步。
MD 的层级、重点和流程图仅作参考，保留自主编排判断。
相关主点尽量同页逐步呈现，必要时翻页，完成后把 MP4 给我审核。
```

已安装为命名 Skill 时，第一行可改为 `使用 $paper-lesson`。只有稿件时会制作无声视频。

- 词级字幕：`*.word.srt` 自动识别，其他文件名由 prepare 加 `--subtitle-level word`；直接使用提供的词时间，不下载声学模型。
- 句级字幕：首次需要本地音文对齐，组件和模型保存在输出目录的 `.paper-lesson-align/`，后续复用。
- Markdown：参考标题、分组、重点、表格和 Mermaid 关系，由模型适配现有组件；不会直接导入原图或原样渲染 Mermaid。字幕与时间以 SRT 为准。
- 修改成片：在同一对话说明要调整的页面或重点，修改原计划再 build，复用原音频、时间和有效缓存。

固定流程为 `prepare → Codex 写 plan.json → build`。单独运行渲染脚本不会替代模型编排。明确的技术错误按 Skill 规则集中修复，不增加默认 LLM 审美循环。

## 文件与开发

| 路径 | 用途 |
| --- | --- |
| [SKILL.md](SKILL.md) | 制作规则与对话入口 |
| [settings.example.json](settings.example.json) | 输出路径、画质与帧率配置示例 |
| [scripts/](scripts/) | prepare / check / build 等固定命令 |
| [runtime/](runtime/) | 独立渲染源码、依赖清单、字体与回归测试 |
| [references/runtime.md](references/runtime.md) | 安装、命令与目录说明 |
| [references/plan-interface.md](references/plan-interface.md) | 模型编排计划接口 |
| [references/word-alignment.md](references/word-alignment.md) | 词级时间输入与句级音文对齐 |

本 Skill 与仓库中的 Python 工作流各自维护源码和依赖，不跨目录共享运行时代码。仓库不包含本机配置、真实输入、生成视频、缓存或安装依赖；原始测试稿及依赖它的历史验收用例留在本地，发布版保留不依赖私人素材的回归测试。

安装依赖后可在 `runtime/` 执行 `npm test` 和 `npm run typecheck`。测试前将 `PAPER_LESSON_PYTHON` 指向本 Skill 的 `runtime/.venv/Scripts/python.exe`，并将 `TEMP`、`TMP`、`TMPDIR` 设为输出目录下已创建的测试临时目录，以免测试临时文件写入系统盘。

字体为寒蝉字型 ChillType 的**寒蝉手拙体**，随包保留[作者说明](runtime/public/fonts/AUTHOR-README.md)与[来源记录](runtime/public/fonts/source.json)。
