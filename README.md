# Auto_video

自动板书视频相关项目，按独立目录维护。

| 目录 | 用途 |
| --- | --- |
| [python_workflow](python_workflow/README.md) | Markdown → 一次模型编排 → 固定排版渲染；支持现成音频、词级 SRT、圈画同步和可选画面字幕。 |
| [skills/paper-lesson](skills/paper-lesson/README.md) | Codex Skill：一次内容编排 → 固定板书渲染 → 用户审核；支持原稿、音频、句级/词级 SRT，默认 4K/30fps。 |

Python 项目的安装、配置和使用方法见其 README。配置模板为 `python_workflow/example.yaml`，复制成未纳入 Git 的 `config.yaml` 后使用。

Skill 的安装和使用方法见其 README，配置模板为 `skills/paper-lesson/settings.example.json`。各项目维护自己的源码与依赖，不跨目录共享运行时代码。

仓库不保存真实凭据、私人输入、安装依赖、下载模型或渲染产物。
