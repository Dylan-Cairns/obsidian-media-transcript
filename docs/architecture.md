# 插件架构

> 定位：**纯字幕播放器**。在 Obsidian 里打开音视频，读取同目录的现成字幕
> （`json` / `srt` / `vtt`）做同步、可点击、跟读高亮。**不含任何语音转文本功能**
> —— 字幕由外部工具（如 `local-asr`）预先生成。

## 文件结构

```
obsidian-media-transcript/
├── manifest.json           # Obsidian 插件元信息
├── package.json
├── tsconfig.json
├── esbuild.config.mjs      # 构建配置
├── styles.css              # 所有 UI 样式
├── main.js                 # 构建产物（发布/部署用）
├── src/
│   ├── main.ts             # 插件入口：注册视图、接管媒体扩展名、设置页
│   ├── MediaTranscriptView.ts  # 主视图（播放器 + 字幕面板 + 交互）
│   ├── settings.ts         # 设置类型 + 设置页面 UI
│   ├── mediaLocator.ts     # 给字幕找媒体：同目录 → vault → 媒体文件夹 → 服务器
│   ├── transcriptIndex.ts  # 字幕 → 媒体名（读字幕里的 source），可随时重建的缓存
│   ├── embeds.ts           # 笔记里的卡片：媒体挪走后的 ![[x.m4a]]、![[x.json]]
│   ├── linkMediaModal.ts   # 手动关联媒体的选择框
│   └── utils/
│       ├── subtitleFinder.ts   # 按命名约定查找字幕文件
│       ├── mediaMatch.ts       # 按文件名配对的规则
│       ├── transcriptSource.ts # 读写 source、解析服务器 index.json
│       └── subtitleParser.ts   # 解析 SRT / VTT / JSON
└── docs/
    └── architecture.md     # 本文件
```

## 数据流

```
用户打开 .mp4 / .m4a / .mp3 …
       ↓
MediaTranscriptView.onLoadFile()
       ↓  isVideo?
   ┌───────────────┴────────────────┐
   视频：左右并排                    音频：顶部细控制条
   playerSide(可拖分隔线) + transcript   audioBar(🎵+播放器+倍速) + 整宽 transcript
       └───────────────┬────────────────┘
       ↓
  findSubtitleFiles()  ──→  同目录按 [name].[marker].[ext] 扫 vault
       ↓
  resolvePriority()    ──→  排序（首项自动加载；当前为直通，可扩展）
       ↓
  loadTrack() → 读文件 → parseSubtitle() → renderSegments()
       ↓
  HTML5 media 元素            字幕段落列表
    timeupdate ──────────────→ syncHighlight()（高亮当前段 + 居中滚动）
```

若同目录没有对应字幕 → 显示"未找到字幕"提示，不做其它动作。

## 找媒体（以字幕为锚）

打开字幕文件时，字幕是锚点，媒体可以在任何地方。

**先问字幕自己**：转录工具会把媒体文件名写进 JSON（`"source": "talk.m4a"`）。字幕文件名
在 Obsidian、Finder、手机上都可能被改，内容不会，所以 `source` 是第一依据；文件名推算只是
没有 `source` 时的备用（SRT/VTT、别的工具）。`.srt`/`.vtt` 没地方写，手动关联的结果记在
设置 `mediaLinks`（字幕路径 → 媒体名），在 Obsidian 里改名时跟着挪。

`TranscriptIndex` 反过来回答「哪些字幕属于 talk.m4a」，给笔记里 `![[talk.m4a]]` 的卡片用。
它只是从文件内容推出来的缓存：vault 的 create/modify/rename/delete 事件都会重读该文件，
Obsidian 外改名（下次看到的是新文件）照样能认出来；插件目录里的 `transcript-sources.json`
只为启动时少读没变过的文件，删了也只是重读一遍（250 份 JSON 冷启动约 0.1s）。

`MediaLocator.resolveForSubtitle()` 按顺序找（有 `source` 时每一步都先精确匹配它）：

设置 **Play from a server first**（`preferRemote`）打开时，第 4 步挪到最前：先问服务器，没有或
连不上再按 1–3 找本地。给「本地副本在 iCloud、可能只是占位符」的库用——本地播放要先等整份下载。

1. 字幕**同目录**
2. 有 `source` 时，**整个 vault** 里叫这个名字的媒体（字幕被挪走、媒体没动）
3. 设置里的 **Media folders**（每行一个，按顺序，含子文件夹）：
   - vault 内路径：在 `vault.getFiles()` 里按前缀过滤
   - 绝对路径（外接盘、iCloud Drive 文件夹）：**仅桌面**，用 Node `fs` 递归列一遍并缓存；
     没命中且缓存超过 30s 才重扫，免得「本来就没媒体」的字幕每次都去扫 2T 的盘。
     播放地址是 `Platform.resourcePathPrefix` + 绝对路径。iCloud 被驱逐文件的
     `.name.icloud` 占位按真实文件名入索引，读取时由系统下载。

4. 设置里的 **Remote media URLs**（每行一个 URL 前缀，如 Tailscale 上的家用机
   `https://old-mac.xxx.ts.net/library`）：先取 `<URL>/index.json`（挪文件脚本写的，
   `files[].path / sha256 / names`），按名字查路径——服务器可以按年月分文件夹，
   在服务器上改过名的文件靠 `names` 里的旧名照样找得到；没查到且索引超过 30s 才重取。
   名字比较前做 NFC + 小写（`nameKey`）：macOS 文件名常是分解形式，同一个「é」/中文标点
   在 JSON 里和磁盘上可能是两种写法。取索引时带 `Cache-Control: no-cache`：rclone 不发缓存头，
   Electron 的 `requestUrl` 会按启发式缓存，拿到旧索引就会指向已挪走的路径。
   同时找媒体的（启动时的卡片、刚打开的视图）共用一次下载；等满 5s 就先按不可达处理，
   但下载继续，晚到的索引照样存下并撤销「不可达」，下一次查找直接用上。
   没有 `index.json` 的服务器没法列目录，就对「候选名 × 扩展名」**并发发 HEAD**，
   命中的再按同一规则挑，远端目录按**平铺**处理。用 `requestUrl` 而不是
   `fetch`：前者不受 CORS 限制（rclone 这类文件服务不发 CORS 头），手机上也能用。
   任何应答（含 404）都算「在线」；5s 没应答算**不可达**，并记 60s，期间再打开不再干等。
   查找期间显示「Looking for audio/video…」，免得空白几秒。媒体在 vault 外时，播放中加载失败
   会弹 Notice（硬盘拔了、服务器睡了），字幕照常可读。

   家用机这一侧：macOS 版 Tailscale 因沙盒不能 `serve` 目录，只能反代，所以在本机
   `127.0.0.1:8080` 跑 `rclone serve http --read-only --dir-cache-time 10s`（支持 Range），
   再 `tailscale serve --bg http://127.0.0.1:8080`。`--dir-cache-time` 默认 5 分钟，
   新挪过去的文件会 404 那么久。

   **Obsidian 录音是分段 MP4**（每 60s 一个 moof、开头没有总索引），远程冷启动要把所有段头
   读一遍：实测 8–9s 才能播。无损重封装 `ffmpeg -c copy -f mp4 -movflags +faststart`
   （`.m4a` 后缀会选到不支持 opus 的 ipod muxer，必须 `-f mp4`）后 0.1–0.2s。

   **系统代理**：Chromium 走系统代理，代理的 DIRECT 从物理网卡出去、到不了 Tailscale 的 utun，
   路由规则救不了；必须把 `*.ts.net`、`100.64.0.0/10` 加进系统代理**例外**。

配对只看**文件名**（`utils/mediaMatch.ts`，纯函数有单测）：字幕名的每个点分前缀都是候选，
视频优先于音频，再按设置里的扩展名顺序。

**都找不到 → 只读模式**（`mt-reading-mode`），不再报错：字幕照常显示、搜索、复制、导出，
顶栏写「No audio/video found · reading only」，悬停列出查过哪些地方（盘没插、路径写错一眼可见），
旁边「Link media…」从 vault、媒体文件夹、服务器索引里挑一个关联（JSON 写进 `source`）。

**媒体还在 vault 时在 Obsidian 里改名**，字幕跟着改名（`fileManager.renameFile`，链接随之更新），
`source` 是旧名的也改成新名；只挪文件夹不改名不用动。
时间戳不可播放；`#t=` 链接改为高亮并居中那一句。

媒体不在 vault 里时没法链接它，所以时间戳链接改为指向**字幕文件**（`[[x.json#t=83|1:23]]`），
笔记里点它同样在旁边打开并定位。

## 布局与交互

- **视频**：播放器在左（填满栏宽、`max-height:75vh`、吸顶），字幕在右；中间
  `.mt-divider` 可拖动调整比例，结果存入 `settings.playerWidthPercent`（默认 75%，设置页也有滑杆）。
- **音频**：无画面 → 顶部一条 `.mt-audio-bar`（🎵 标题 + 原生播放器 + 倍速），
  字幕占满整宽。
- **倍速**：`0.75/1/1.25/1.5/2x`，设置 `mediaEl.playbackRate`（视频音频通用）。
- **字号**：字幕工具栏 `A− / A+`（步进 1px，范围 10–32），写入
  `settings.transcriptFontSize`，通过 `.mt-transcript` 上的 `--mt-font-size`
  行内变量生效；时间戳/说话人小块用 `em` 相对缩放。设置页滑杆改的是同一个值，
  两处都会 `applyFontSizeToOpenViews()` 实时应用到所有已打开视图。
- **自动滚动**：`scrollActiveIntoCenter()` 把当前段滚到面板**垂直居中**
  （用 `offsetTop`，因此 `.mt-transcript` 必须 `position: relative`；末尾
  `padding-bottom: 40vh` 让最后几段也能居中）。用户 `wheel/touchmove` 手动滚动后
  暂停 4s（`MANUAL_SCROLL_GRACE_MS`），点击段落立即恢复；可用
  `settings.autoScroll` 整体关闭（关闭后仍高亮）。
- **搜索**：工具栏下面一行 `.mt-searchbar`（输入框 + `n/m` 计数 + ↑/↓）。
  `applySearch()` 大小写不敏感的子串匹配（CJK 同样可用），把命中段的 `.mt-txt`
  重建成「纯文本 + `span.mt-hit`」交替结构（不用 innerHTML）；`clearHighlights()`
  按 `highlightedSegs` 还原原文。命中列表 `hitEls` 扁平存放每一处，
  `gotoHit()` 标 `.mt-hit-current` 并把所在段滚到居中，同时刷新
  `manualScrollUntil` 避免播放把视图拽走。首次跳转从**当前播放段**往后找，
  找不到就回到第一处；切轨/重渲染后会用当前关键词重跑一次。
  命令 `search-transcript` → `focusSearch()`（可自行绑快捷键）。
- **视频 ⇄ 纯音频**：`settings.videoAudioOnly`（工具栏 🎧/🎬 按钮 + 设置页开关）。
  `buildLayout()` 按当前模式搭布局，`transcriptSideEl` 整列**移动复用**，
  所以切换不重新解析字幕、不丢搜索结果和滚动位置；`rebuildPlayer()` 只换播放器，
  把 `currentTime / playbackRate / paused` 搬过去（新元素 `readyState === 0` 时
  推迟到 `loadedmetadata` 再 seek）。纯音频模式用 `<audio>` 播视频文件（同一套解码器），
  万一某容器不支持会触发 `error` → Notice 提示并自动退回视频模式。
- **文字可选**：`.mt-txt` 显式 `user-select: text`（Obsidian 从 `body` 往下继承的是
  `none`，所以必须显式打开）。这样才能划选复制，别的插件也才能在字幕上做标注。
  时间戳/说话人小块保持不可选，免得拖选时把它们一起带上。
  段落的 click→seek 会在**存在选区时跳过**，否则划完文字就被拽走播放位置。
- **对外广播**：每次重建字幕 DOM（换轨、搜索高亮重写 `.mt-txt`）后：
  - 在 `.mt-transcript` 上写 `data-mt-media` / `data-mt-track`
  - 派发冒泡的 `mt:transcript-rendered`（detail 同上）
  - 每段带 `data-mt-seg` / `data-mt-start`

  **两者都要**：事件只能被「当时在听的人」收到，而 DOM 属性任何时候都能读。
  在字幕已经打开之后才被启用的插件收不到事件，只能靠属性。单向，本插件不关心谁在听。
- **播放入口是时间戳，不是整行**：点 `.mt-ts` 才 seek+play。原来点整行会 seek，
  和「选中文字」抢同一个点击 —— 每次想划词或复制都会把播放位置带走。
  按**目标元素**分开比按「有没有选区」猜要可靠。
- **交互**：右键 → 菜单（从此处播放 / 复制时间戳 / 复制文字）；
  点左侧时间块 → 复制时间戳；hover 仅高亮，不弹按钮（不影响布局）。
- **笔记里的嵌入 / 链接**：`registerExtensions` 只管「打开文件」，`![[x.m4a]]`
  走的是另一套 `embedRegistry`，所以以前嵌入处完全没有插件的入口。
  - 嵌入：包一层 core 的 embed 工厂（不替换），有字幕时在原生播放器后加
    「Transcript」按钮；没字幕保持原样。点按钮把内联播放器的位置/播放状态交给字幕视图并暂停内联。
  - 打开位置：`openTranscript()` 一律开在**笔记旁边**（右侧分屏），复用已开的字幕面板，
    不替换正在写的笔记。
  - 时间戳链接：右键「Copy timestamp link」/ 命令 `insert-timestamp-link` 生成
    `[[x.m4a#t=83|1:23]]`。`#t=` 是 Obsidian 原生嵌入也认的媒体片段语法，卸了插件也能用。
    普通点击经包装后的 `workspace.openLinkText` 路由到旁边的字幕视图并 seek；
    带修饰键的点击保持原行为，视图在 `setEphemeralState` 里同样处理 `#t=`。
- **媒体离开 vault 之后的笔记**（`embeds.ts`）：
  - `![[x.m4a]]` 找不到文件时，Obsidian **不调用任何 embed 工厂**，阅读视图和 Live Preview
    都只渲染同一个 `.internal-embed.mod-empty-attachment[src]`（「找不到…」）。所以用
    `MutationObserver` 在 DOM 里找它：若 vault 里**任意位置**有同名字幕
    （`findSubtitlesByBaseName` + 优先级），就地换成**字幕卡片**，`#t=` 照样生效；
    没字幕就保持 Obsidian 原样。不改写笔记，老笔记自动可用。
  - `![[x.vibevoice-4bit.json]]`：为 srt/vtt/json 注册 embed 工厂（仅当没人占用），渲染同样的卡片；
    不是字幕的 json 只显示文件名。
  - 卡片 = 标题 + 播放器（媒体走和字幕视图同一套查找：同目录 → 文件夹 → 远程）+ Transcript 按钮
    （在旁边打开完整视图，交接播放位置）。宿主元素自带「找不到」的内边距/背景/居中，
    `.mt-card-host` 把它们清掉。卡片内 mousedown/click 不冒泡：否则 Live Preview 会切回源码、
    缺失文件的 embed 会提示创建文件。
  - Obsidian 重开笔记时会**复用**已渲染的 embed，没找到媒体的卡片（服务器睡了）不会自己刷新，
    所以「No audio/video found」后面带 **Retry**。
  - 卡片被移出页面时，其播放器要停掉（脱离 DOM 的 `<audio>` 会继续响）：每批 DOM 变动后回收。
  - 链接 `[[x.m4a#t=83]]` 找不到文件时，直接落到 Obsidian 会提示**新建** x.m4a；改为按名字找字幕打开。
- **扩展名接管**：`main.ts` 逐个 `registerExtensions`，被其他插件占用时先
  `unregisterExtensions` 再接管，避免冲突导致加载失败。

## 测试

```bash
npm test        # vitest，watch 用 npm run test:watch
```

只测**纯逻辑** —— `utils/subtitleParser.ts`。视图那一层是 DOM 胶水，单测收益低于
维护成本，走手工。但解析器不一样：它决定「这个文件是不是字幕」，错了是**静默**的
（空白行、误导的提示），手工点击恰恰发现不了。

## 开发循环

```bash
npm run dev    # esbuild watch，每次构建后自动复制到 dev vault
```

部署**用复制不用软链** —— 本 repo 在 iCloud Drive 上，把 vault 指向 iCloud 路径
有 Obsidian 卡在被 evict 的文件上的风险。

**部署到哪是这台机器的属性，不是插件的属性**，所以从环境变量 `VAULT_PLUGIN_DIR`
或一个 gitignore 掉的 `.dev-vault` 文件（内容是 vault 根目录）读，两者都没有就
不部署。CI 因此天然跳过，别人 clone 下来也不会莫名其妙往某个不存在的目录写东西。

`styles.css` 不是 esbuild 的输入，所以单独 watch。

构建时会写一个空的 `.hotreload` 标记，装了 pjeby/hot-reload 就能**存盘即重载**，
不用退出 Obsidian。之前一直要手动重启，就是因为少了这个文件 —— hot-reload
只盯带标记的插件目录。

## 字幕文件命名约定

Pattern：`{mediaBasename}[.{marker}].{subExt}`

| 例子 | marker | subExt |
|------|--------|--------|
| `video.srt` | `""` (空) | `srt` |
| `video.vibevoice-4bit.json` | `vibevoice-4bit` | `json` |
| `video.en.vtt` | `en` | `vtt` |

搜索目录：`settings.subtitleDirectory`，留空则为媒体文件同目录。

## 「这是不是字幕」怎么判断

`.json` 是**整个扩展名**被注册的（Obsidian 没法按文件挑），所以各种根本不是字幕的
JSON 都会落到这个视图里 —— 包括 Attention 写的 `<文件>.anno.json`。空状态提示要
区分两种情况，因为建议正好相反：

| 情况 | 该说什么 |
|------|---------|
| 是字幕，但旁边没有媒体 | 把同名音视频放到同目录 |
| 压根不是字幕 | 这个视图只开字幕；你点错文件了 |

**只用一个定义，用在两处**：判断依据就是 `parseSubtitle()` 有没有解析出段落。
另起一套「像不像字幕」的启发式规则，迟早会和真正的解析逻辑漂移。

为此解析器收紧了：**没有文字就不是一行字幕**。原来 `toSegment` 会把任意对象映射成
`text:''` 的空段落，于是 `[{a:1},{b:2}]` 会被当成 2 段字幕 —— 既让分类判断错，
也会在字幕面板里渲染出**可点击的空白行**。现在 `collect()` 丢掉这些再重新编号。

判断只在**出错路径**上读文件，正常打开字幕不受影响。

## 支持的字幕格式

| 格式 | 扩展名 | 说明 |
|------|--------|------|
| SubRip | `.srt` | 最通用，时间码精确到毫秒 |
| WebVTT | `.vtt` | Web 标准，支持样式标签（自动剥离）|
| JSON | `.json` | `{segments:[{start,end,text}]}`（兼容 local-asr / Whisper verbose_json；speaker 字段忽略）|

## 待实现 / 可扩展

- [ ] `resolvePriority()` 目前为直通，可按 marker 优先级排序（多字幕并存时选默认）
- [ ] 键盘快捷键（空格暂停/继续，左右箭头跳句）
- [ ] 在字幕里显示说话人 `[S0]` 前缀（parseJSON 读出 speaker 即可）
