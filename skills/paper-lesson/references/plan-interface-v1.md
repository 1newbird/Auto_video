# Plan 接口 v1

> 仅供维护历史 v1 计划。新稿使用 [plan-interface.md](plan-interface.md) 的 v2 行内目标和知识点结构，不沿用本页关于拆分强调对象的旧做法。

统一入口：Skill 根目录的 `scripts/paper-lesson.mjs`。命令与新接口相同，仅 `plan.json` 保留 v1 数据结构。以下命令在 Skill 根目录执行；任务目录使用绝对路径且位于 Skill 目录之外，含空格的路径加引号。安装说明见 [runtime.md](runtime.md)。

## 作者输入与源文件

```powershell
node scripts/paper-lesson.mjs prepare --script "原稿绝对路径" --job "新任务目录绝对路径"
```

用户允许选段时可追加 `--start "起始原文" --end-before "结束位置原文"`。否则使用全文。输出 `source.json` 和 `script.txt`。保留 source 的 hash 和分段，不手工修改这些文件来绕过校验。

`source.json` 包含 `sha256`、规范化的 `text`，以及 `segments`（id、start、end、text）。分段范围为 JavaScript UTF-16 索引；只引用现有 ID 即可。

## Plan 根对象

```json
{
  "schemaVersion": 1,
  "sourceHash": "复制 source.json 的 sha256",
  "unitsPerSecond": 4.2,
  "pages": []
}
```

`unitsPerSecond` 是无声阅读/讲解时间估计，可选，允许 2–7；不是实际语音速度承诺。页面按叙述顺序排列，每页 `segments` 必须连续覆盖对应段落。所有页面合起来必须覆盖原文每段一次，不能遗漏、重复或调换顺序。

## 双列笔记页 notes

```json
{
  "id": "concepts",
  "title": "页面标题",
  "subtitle": "可选短引导",
  "layout": "notes",
  "segments": ["s001", "s002"],
  "blocks": [{
    "id": "concept",
    "title": "1. 核心概念",
    "segment": "s001",
    "column": 0,
    "lines": [
      {"id": "definition", "text": "板书摘要", "segment": "s001"},
      {"id": "remark", "text": "红色备注", "segment": "s002", "red": true}
    ]
  }],
  "gestures": []
}
```

`column` 可选（0 左，1 右），未提供时放入当前较短一列。块标题、每条 lines 都能作为笔的目标。line 的 segment 默认使用块的 segment。文字按字体实际字宽换行。出现时间由程序设为绑定讲解段落开始前约 0.4 秒。

先规划该页所有对象的位置，再按时间显现，因此后续内容不会挤动旧内容。越界将报错，应减少摘要或分成多页。

## 纵向流程页 flow

```json
{
  "id": "process",
  "title": "操作流程",
  "layout": "flow",
  "segments": ["s003", "s004"],
  "steps": [
    {"id":"input","title":"1. 输入","detail":"可选框内短说明","segment":"s003",
     "notes":[{"id":"input-note","text":"右侧旁注","red":true}]},
    {"id":"output","title":"2. 输出","segment":"s004",
     "notes":[{"id":"output-note","text":"右侧旁注"}]}
  ],
  "gestures": []
}
```

每页 2–5 个步骤。节点框、箭头和位置自动生成。步骤 id 对应标题文字；可选 detail 的目标 ID 为 `步骤id-detail`；旁注使用自己的 id。notes 的 segment 默认继承步骤，也可指定同页的其他段落。

## 笔手势

```json
{
  "id": "emphasize-remark",
  "kind": "point",
  "target": "remark",
  "segment": "s002",
  "quote": "这段原文中确实存在且唯一的短语",
  "duration": 2.6,
  "ink": false
}
```

- `kind`: `point` 指向停留；`sweep` 沿对象下方移动；`orbit` 绕对象比画；`link` 从 target 到 `to`；`underline` 下划线轨迹；`circle` 圈形轨迹。
- `target` 必须是同页有效对象。`link` 还需 `to` 指向另一个已出现对象。
- `ink` 必填。仅 `underline` / `circle` 允许 true；false 时只移动笔，结束后不留线。
- `segment` 指定台词段落，`quote` 可选，须在该段唯一出现。动作从该短语的估计时间开始；没有 quote 则从段落开始。
- `duration` 包含进场、动作/停留和退出，默认 2.6 秒，允许 1.6–6 秒。`offset` 可选，为锚点后额外等待秒数，非负。
- 动作不能重叠，间隔至少 0.2 秒，不能跨页；目标必须已出现。程序会校验这些约束。
- 跨两行的文字会作为整体目标。需要强调某个词时将其编排为独立板书对象，不给渲染器随意写像素坐标。

所有对象 ID 在本页内唯一，避免使用保留 ID `page-title` / `page-subtitle`。页标题保持简短，流程框标题通常一行、detail 通常一行；过长时应精简板书摘要，不改变原稿。

## 编译与渲染

```powershell
node scripts/paper-lesson.mjs compile --job "任务目录绝对路径"
node scripts/paper-lesson.mjs preview --job "任务目录绝对路径"
# 模型按 roles/reviewer.md 审阅并写入 review.json 后：
node scripts/paper-lesson.mjs render --job "任务目录绝对路径"
node scripts/paper-lesson.mjs verify --job "任务目录绝对路径"
```

产物在任务目录 `output/`，包括 `lesson.json`、`captions.srt`、`compile-report.json`、`lesson.mp4`、`page-N.png`、`storyboard.jpg` 和验证报告。修改计划后重新编译、预览和审阅，再生成所需视频，避免混用旧静帧与新视频。

渲染器当前固定 1080×1920、30fps；无声估计时间上限 30 分钟。笔为代码绘制的可替换矢量资产。没有接入音色克隆、自动发布或独立模型 API。
