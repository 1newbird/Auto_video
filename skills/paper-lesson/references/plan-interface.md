# Plan 接口 v3

统一入口为 Skill 根目录的 `scripts/paper-lesson.mjs`。以下命令在 Skill 根目录执行；含空格的路径加引号，任务路径使用绝对路径且位于 Skill 目录之外。LLM 输出语义计划，固定程序计算字体、位置、轨迹和时间。本接口不依赖讲解题材。安装与完整命令见 [runtime.md](runtime.md)。

## 作者输入与源文件

```powershell
node scripts/paper-lesson.mjs prepare --script "原稿绝对路径" --job "新任务目录绝对路径"
```

用户允许选段时可追加 `--start "起始原文" --end-before "结束位置原文"`，否则使用全文。任务目录输出 `source.json` 和 `script.txt`，编排者在同目录创建 `plan.json`。保留源文件的 hash 和分段，不手工修改它们绕过校验。

Markdown 结构参考：编排时读取任务内未经清洗的 `original-script.txt`，旧任务缺少时读取 `source.json.sourcePath`。在授权内容范围内参考标题层级、列表分组、加粗重点、表格对比及 Mermaid 节点/连接关系，再适配到 section、tree、flow、relation、parallel 等现有组件。MD 的排版和图示不一定最优，仅提供参考线索；模型自主判断是否采用，以内容准确、讲解清楚和视频观看体验为优先，可以重新分组、更换图形、调整分页或舍弃不合适的原排版，保留事实、必要条件和真实关系。清洗后的 script.txt/referenceScript.text 不保留全部 Markdown 标记，不能作为原稿结构的唯一依据。图片链接不会自动转成图片元素。自主判断仍在一次编排中完成，不增加导图、审美或合页循环；同主题相关主点优先同页累积，不能一个 MD 标题就分一页。

`source.json` 包含 `sha256`、规范化的 `text`，以及 `segments`（id、start、end、text）。分段范围为 JavaScript UTF-16 索引；计划只需引用已有 ID。口播原文用于字幕，板书可以摘要，但应保留关系和必要限定。

现成音频输入：prepare 追加 `--audio "音频路径" --subtitles "SRT路径"`。`*.word.srt` 自动导入词时间，其他词级文件名加 `--subtitle-level word`。`timingMode=subtitles` 时，text/segments 来自字幕，清洗后的 Markdown 文本保存为 referenceScript，未经清洗的原稿另存 original-script.txt；每段对应一条句级 SRT 或词级记录合并后的句子，另有 startSeconds、endSeconds。口播顺序、字幕、segment 和 quote 均以 SRT 生成的 source 为准，MD 的排版与流程图只供板书编排参考，不进入字幕。逐词时间保存在 word-timings.json，不必读出全部时间记录来编排。程序检查时间顺序和音频时长；段间停顿保留，翻页不额外插入时间，片长取音频长度向上取整到一帧。原始文件都归任务目录。

音频模式仍使用同一份语义计划：元素绑定 segment，每个 ink:true 的圈画/下划线必须提供 segment + quote，quote 是口播中唯一出现的重点词/短语。不要填写 unitsPerSecond、动作 duration/offset；程序从导入的词时间或本地音文对齐结果确定实际落笔时间，提前进场，短字幕切换也按词级结果安排。check/build 复用 word-timings.json；句级字幕缺少词时间才本地对齐，没有第二轮 LLM、稿件识别改写或语音生成。动作冲突时缩短笔迹，不移动关键词落笔时刻；确实挤不下则报告合并强调或改用红字。给定时间和自动对齐结果仍需用户听看确认。详见 [词级对齐](word-alignment.md)。

## Plan 根对象

先把同一主题的相关主点、例子、补充与简短小结组织为同页累计板书，再按真实容量或明确主题转换分页。一个 page 可以包含多个编号 section，分别绑定讲到该主点的 segment；不按字幕段、标题数量或少量条目机械分页。简短结尾先考虑放回前页，页标题概括整组内容，避免重复写第一节标题。板书逐步增加，之前内容保持位置；正常字号和清楚层次优先，不额外发明内容填满纸面。该取舍在首次计划中完成，不增加 LLM 审美或反复合页步骤。

```json
{
  "schemaVersion": 3,
  "sourceHash": "复制 source.json 的 sha256",
  "unitsPerSecond": 4.2,
  "pages": []
}
```

`unitsPerSecond` 可选，允许 2–7，是无声讲解时间估计，不是实际语音速度承诺。所有页面的 `segments` 合起来必须按原文顺序覆盖每段一次，不能遗漏、重复或调换顺序。

## 知识点 row 与行内 run

一个 row 表达一个知识点，可以自动换成数行。行内颜色和独立笔目标通过 run 表达，不要求另起一行。

| 字段 | 含义 |
| --- | --- |
| `id` | 本页唯一的知识点目标 ID |
| `kind` | `definition`（术语与解释）、`text`（普通表达）、`bullet`（列举项） |
| `label` | definition 必填的术语标签，程序自动补冒号 |
| `runs` | 按阅读顺序排列的文字片段，每项有 `text`，可有 `id`、`red`、`segment` |
| `segment` | 所绑定讲解段落；未提供时继承所在块或步骤 |
| `children` | 可选子 row 数组，用缩进和树形线表示归属 |

run 的 `segment` 默认继承 row。整条红色备注可把各 run 设为 `red: true`；需要只突出某个词时，仅将该词所在 run 设红。同一知识点按逻辑绑定讲解段落，标签先出现；run 可绑定较晚段落，在讲到该说明之前补充出现。文字的位置预先排好，后续出现不挤动旧内容。

可指向的对象包括 row 的 `id`、定义标签的自动 ID `行id:label`，以及显式命名的 run。没有强调用途的片段无需额外命名。

例如，“主动回忆：不看材料，尝试复述内容”属于一个知识点，其中“不看材料”可以单独被圈住：

```json
{
  "id": "recall",
  "kind": "definition",
  "label": "主动回忆",
  "segment": "s002",
  "runs": [
    {"id":"without-notes","text":"不看材料","red":true},
    {"text":"，尝试复述内容"}
  ]
}
```

若另一个对象确实是它的组成部分，可放入 `children`（最多 4 层）；只是后面另一个独立知识点时，使用同层 row。对比内容可用并列、对应清楚的 definition 行；不要把只有排版先后的内容误写成父子或流程关系。

程序测量实际字宽、自动换行并计算续行缩进。一个目标跨行时会保留多个实际矩形，圈画按各行定位，行间移笔不留线，不把中间空白一起包成大圈。定义标签的自动目标只覆盖标签文字，不包含程序补的冒号。无需在计划中添加像素坐标、矩形或笔路径。

## 笔记页 notes

```json
{
  "id": "methods",
  "title": "两种学习动作",
  "subtitle": "看过之后，再尝试自己说出来",
  "layout": "notes",
  "columns": 1,
  "segments": ["s001", "s002", "s003"],
  "blocks": [{
    "id": "methods-block",
    "title": "理解与回忆",
    "segment": "s001",
    "rows": [
      {"id":"review","kind":"definition","label":"重读","segment":"s001",
       "runs":[{"text":"再次阅读材料"}]},
      {"id":"recall","kind":"definition","label":"主动回忆","segment":"s002",
       "runs":[{"id":"without-notes","text":"不看材料","red":true},{"text":"，尝试复述内容"}]},
      {"id":"check","kind":"text","segment":"s003",
       "runs":[{"text":"复述后，对照原文检查遗漏"}]}
    ]
  }],
  "gestures": []
}
```

v2/v3 的 `columns` 允许 1 或 2，默认 1；v1 保留旧双列行为。块的 `column` 可选（0 左，1 右）；显式双列时放入较短列。新稿优先使用下文 mixed，按需要局部并列。

块标题、各 row、定义 label 和命名 run 都能成为笔目标。若超出内容区，编译会报错；应缩短板书摘要、调整合理的列数或增加页面，不删减原文字幕，也不无限缩小字体。

## 旧式纵向流程页 flow（兼容格式）

```json
{
  "id": "cache-process",
  "title": "一次缓存查询",
  "layout": "flow",
  "segments": ["s004", "s005"],
  "steps": [
    {"id":"lookup","title":"1. 查询缓存","detail":"查找已有结果","segment":"s004",
     "notes":[{"id":"hit","kind":"definition","label":"命中",
       "runs":[{"text":"使用已有结果"}]}]},
    {"id":"load","title":"2. 必要时读取来源","segment":"s005",
     "notes":[{"id":"miss","kind":"definition","label":"未命中",
       "runs":[{"id":"fetch-source","text":"读取来源","red":true},{"text":"，再保存结果"}]}]}
  ],
  "gestures": []
}
```

此旧格式保留 2–5 步的固定版式，仅用于旧任务兼容。新计划统一使用下方 mixed 页内的 flow，按实际空间自适应，没有节点数量上限。不要为适配旧模板删减步骤。v2 的 steps.notes 使用 row 结构；row 的 segment 默认继承步骤。

步骤 id 指向标题，可选 detail 的目标 ID 为 `步骤id-detail`。备注、标签和 run 使用各自 ID。

## 笔手势与用途

```json
{
  "id": "remember-without-notes",
  "intent": "emphasize",
  "kind": "circle",
  "target": "without-notes",
  "segment": "s002",
  "quote": "该段原文中确实存在且唯一的短语",
  "duration": 2.6,
  "ink": true
}
```

`intent` 是 v2 必填的规划用途：

| 用途 | 选择条件 | 本版执行方式 |
| --- | --- | --- |
| `guide` | 帮助观众找到当前讲解对象 | `point`、`sweep` 或 `orbit`，`ink: false` |
| `emphasize` | 需要留下可持续看到的重点标记 | `underline` 或 `circle`，`ink: true` |
| `relate` | 在两个对象之间引导视线 | `link` 加 `to`，`ink: false` |

不必凑齐三种用途，也不规定每页多少次动作。红色文字本身可以构成强调，无须另加笔事件；一旦选择落笔强调，就应实际留线，不能用悬空运动替代。当前 `relate` 不绘制持久连接线。

- `target` 必须是同页有效目标；`link` 的 `to` 也必须已出现。
- `segment` 是讲解段落 ID。可选 `quote` 须在该段原文中唯一出现；动作从该短语的估计时间开始，没有 quote 则从段落开始。
- `duration` 包含进入、动作或停留、退出，允许 1.6–6 秒。未指定时，单行目标使用 2.6 秒，多行目标按行数适度延长（不超过 6 秒）。可选 `offset` 是锚点后额外等待秒数，非负。
- 动作不能重叠，间隔至少 0.2 秒，不能跨页；程序会校验时间和目标。
- 同一知识点里想强调具体词语时，为对应 run 命名，不拆成独立行。圈的大小与位置由渲染器根据目标的实际矩形确定。

所有自定义对象 ID 在本页内唯一，避免保留 ID `page-title`、`page-subtitle`，也不要与自动生成的 `行id:label`、`步骤id-detail` 冲突。

## 编译与直接渲染

```powershell
node scripts/paper-lesson.mjs build --job "任务目录绝对路径"
```

默认 review-policy=user，编译后直接渲染，视觉由用户审核。不默认 preview、inspect、独立审阅或 LLM 审美。程序会先做确定的格式转换和实际尺寸检查；明确计划错误允许一次集中技术修复，具体边界见 [Skill](../SKILL.md#技术错误处理)。

只在用户明确要求静帧时执行 preview。收到反馈后直接修改计划，按相同步骤重新导出：

```powershell
node scripts/paper-lesson.mjs build --job "任务目录绝对路径"
```

只查格式与排版时使用 check --job，它实际编译且不出视频；之后 build 复用有效编译结果。完整输出在任务目录的 output/，包括 normalized-plan.json、lesson.json、captions.srt、compile-report.json、lesson.mp4 和轻量验证报告。原 plan.json 保留，自动转换记录在 compile-report.json.repairs；错误同样写报告并返回非零退出码。预览图片仅在显式 preview 时生成。所有任务及临时文件都位于配置输出目录内，--job 不可越界。未变的画面资产复用；verify --regression 是开发检查，不作为日常步骤。

清晰度与帧率由 settings.json 控制，默认竖屏 4K（2160×3840）、30fps；支持 1080p/1440p/4K 与 30/60fps。计划不增加分辨率、帧率或像素坐标字段；改变画质后复用该计划重新 build。估算时长上限 30 分钟。笔是可替换的矢量资产。没有接入音色克隆、自动发布或独立模型 API。

## v1 兼容

历史 `schemaVersion: 1` 计划继续使用 `blocks.lines` 和旧式 `steps.notes`（id、text、segment、red），旧动作字段保持兼容。维护旧任务时查看 [plan-interface-v1.md](plan-interface-v1.md)。v2 仍支持 rows、runs、intent，新稿使用 v3 mixed；不要只改版本号而保留 v1 字段，也不要要求渲染器按主题修补某份计划。

## 同页组合 mixed（v3）

页面用 `layout: "mixed"` 和按阅读顺序排列的 `elements`。全页默认纵向布局，程序预先排好所有位置，后续内容出现不会挤动旧内容。每个元素有本页唯一 id、kind、可选 segment（默认页面首段）。不接受自定义坐标或未知元素字段。

| kind | 字段与表达 |
| --- | --- |
| section | title 加 rows 或 elements（二选一）；elements 将从属文字和图解整体缩进一级，适合编号主点 |
| text | rows：一组知识点 |
| note | rows：侧边红线旁注 |
| divider | 分隔线，不带文字 |
| tree | 可选 title、rows；用 row.children 表达真实归属 |
| flow | nodes：至少 2 个步骤，无数量上限；direction 为 horizontal（默认）或 vertical；默认顺序箭头，也可显式 links 指定箭头出现段落 |
| relation | nodes、links：至少 2 个水平对象，无数量上限；显式关系箭头，仅连接相邻对象避免穿越无关节点 |
| parallel | reason 说明并列依据，groups 为两个 elements 数组；仅这一区域并排，标题与分组按实际可用空间排版，不设两层嵌套上限 |

nodes 每项有 id、title、可选 detail、segment、red（布尔值，只控制标题红色）。程序测量实际字宽与页面高度，自动换行；放不下时缩小字号、框间距、标题与正文，保留节点和顺序。正常图标题 38px、细节 32px，最低细节约 18px；没有“最多四个节点”或“最多两行”规则。整个 mixed 页在最低字号仍超出纸面时，报告具体元素，再按知识关系拆页；不能删掉步骤凑数量。

parallel.groups 的标准形式为两个 elements 数组，即 groups: [[...], [...]]。工具也接受 groups: [{"elements":[...]}, {"elements":[...]}]，仅展开这一层等价包装；带其他字段的对象不会被静默丢弃。

编号优先写 `1.`、`2.`。板书文字中的圈号数字等常见符号若当前字体缺字，程序自动替换为可绘制的等价文本（例如 `①` → `1.`、`→` → `->`），并记录到 compile-report.json.repairs；支持的原字符保持不变。该转换只作用于板书显示，不修改字幕、原稿、quote 或 ID。其他无法替换的缺字会连同字段位置汇总报告，不隐藏字符。编译阶段汇总各页可定位的排版问题到 issues，集中处理后再 build。

links 每项为 from、to、可选 label、segment；无 segment 时在两端均出现后显示。显式段落早于节点时，工具自动延后到两端都出现的段落并记入报告；缺失节点或不存在的段落仍报告错误。label 必须短到能放在水平节点之间，纵向 links 不使用 label。持久箭头是板书元素，与 link 笔动作分开。任意非相邻跨线图或复杂自动路由目前不支持。

```json
{
  "id":"overview", "title":"保存并使用经验", "layout":"mixed",
  "segments":["s001","s002","s003"],
  "elements":[
    {"id":"intro","kind":"section","title":"从一次实践开始","segment":"s001",
     "rows":[{"id":"idea","kind":"text","runs":[{"text":"把有效做法保存下来，下一次继续使用。"}]}]},
    {"id":"process","kind":"flow","segment":"s002","nodes":[
      {"id":"draft","title":"初稿"},{"id":"revise","title":"修改"},{"id":"save","title":"保存经验"}]},
    {"id":"roles","kind":"relation","segment":"s003","nodes":[
      {"id":"runtime","title":"运行机制"},{"id":"skill","title":"技能"}],
      "links":[{"from":"runtime","to":"skill","label":"加载"}]}
  ],
  "gestures":[]
}
```

元素 id、节点 id、row/run id 都可作为笔目标；有 title 的元素 id 指标题，节点 id 指节点标题，其他组合 id 指组合范围。节点 detail 的目标为 `节点id:detail`。内容使用简体中文；代码、路径、英文和专名按原稿保留。字形疑问须检查实际图片，不能仅凭字体包含该字符就声称解决。
