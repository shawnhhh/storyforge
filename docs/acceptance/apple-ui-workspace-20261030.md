# StoryForge P0：Apple 关联式创作工作台验收报告

## 范围与来源

独立 Draft PR：[PR #45](https://github.com/shawnhhh/storyforge/pull/45)，分支 `feat/storyforge-apple-ui-workspace`，base 为 `integration/g1-unified-beta-20261029`。2026-10-30 实际读取远端：main HEAD `1a6895f3c69c932b131554e380de6b5cd4d54a41`；#44 保持 Draft、未合并，HEAD `da140c23ece249beb5e6a64ff0c7bd62c70b41d3`，五组工作流 completed/success。直接从该完整 CI G1 候选建立独立 worktree，没有复制旧 main 功能、重复 cherry-pick 或修改 #35–#44 分支。

本次实现 UI 与资料查询/关联交互，并修复回归测试实际暴露的备份恢复标识映射错误；未继续新增免费音乐/视频编辑业务。不改 SQLite schema、Provider 协议、任务队列、CAS、媒体导出或统一备份恢复契约。没有新增运行时依赖。保持 Draft，不合并、不强推、不删除既有测试。

## 实际应用行为

- 左栏集中小说、章节、小说资料模块、人物关系与时间线，以及音乐/视频入口；顶栏显示作品/章节路径、外观与专注/检查器控件。侧栏可收起。
- 中间仍为原 ChapterEditor/Tiptap，沿用正文保存队列、草稿保护、版本冲突、快捷键、字数/写作目标、长文滚动与章节保存后导航。未重新实现业务编辑器。
- 右侧独立章节检查器：人物、世界观、剧情三标签。显示当前章节真实引用，不从正文猜测或写死演示人物。
- 人物：名称/身份/完整非空档案字段，读取真实 `relations` 构造 SVG 关系图；包含本章人物的入边/出边，可查看相关人物及其设定。
- 世界观：地点、势力组织、力量体系、历史、其他设定沿用既有分类；显示全文、标签、时间和设定之间的关联，支持原地查看组织等档案。
- 剧情：章节大纲、主线/支线（经关联剧情卡确定）、剧情卡、伏笔埋设/推进/回收和统一 `storyTimeline` 事件。无既有模型的字段不虚构。
- 人物/设定可手动增加或取消章节关联；沿用 knowledge-links PUT 与版本 CAS。取消会明确确认并沿用现有引用归档行为，正文/资料保留。失败显示错误并保留选择，版本冲突要求刷新核对后手动重试，不静默覆盖。
- 新旧资料引用面板互相广播已确认 snapshot，单调接受版本；不为同步额外发送查询。两者保存 busy 分别记录后聚合，防止一方完成时提前允许离开另一方正在保存的操作。
- Music、Video 和 Studio 使用同一组语义色彩、系统字体、主题选择、导航、表单/按钮/状态语言，保留歌词、音频、分镜、播放器、素材、工程导入导出、任务与预算布局。生成测试只用免费本地 Mock。

## 设计与响应式

共享 `--sf-*` tokens 覆盖 surface/panel/field/sidebar/toolbar/text/muted/border/accent/selected/focus/error、圆角和阴影。浅色采用柔和灰色侧栏、白色正文与轻量分隔；深色采用中性深灰，专门覆盖旧全局 dark 控件填充，避免标题和导航变成厚重卡片。系统字体含 PingFang SC，减少装饰与持续动画，遵循 reduced-motion。

外观偏好复用原本地 preferences；HTML 首帧先读取主题，React 接管后继续响应系统主题变化，降低首屏闪烁。主题在小说/Music/Video 切换后保留。未声称消除所有显示器/浏览器的闪烁。

桌面左栏 236px、右栏 300px，中间保持可编辑正文；1180px 以下检查器以覆盖面板呈现，避免挤压正文；720px 以下侧栏变为可折叠紧凑导航。专注模式使用 CSS 隐藏左右栏，正文组件保持原节点。原 390/1024/1440/2560 布局断言仍保留；新增 1280/1440/960 几何与截图检查。

## 性能与编辑安全证据

检查器本地持有小说级三个快照（story-bible、knowledge-links、planning）；切换标签及章节从快照筛选。自动化断言切换三个标签后相关 GET 请求数为 **0**，正文 DOM 相等、Tiptap selection 与原生 range 均保留。刷新资料才重新查询。没有引入图谱运行时依赖。

资料面板内部状态不进入正文编辑状态；关联保存不把正文设为只读。正文保留原 `shouldRerenderOnTransaction: false`、memo DocumentBody、增量统计和保存队列。原长文、自动保存、滚动、队列、失败草稿断言保留。未做硬件级帧率/内存或百万字压力测试，不捏造耗时提升百分比。

## 自动化记录与边界

验证全部使用隔离临时数据库、临时媒体、合成作品/人物与 Mock；未读取、覆盖或删除用户真实数据库/媒体，未读取 `.env`，未调用付费模型或外部真实 Provider。

- `npm ci`：通过，锁文件不变。
- lint、typecheck、build：通过；构建保留 beta 清单与懒加载正文编辑器。
- 完整单元/API：**321/321**，0 失败/跳过。
- 集中数据安全 `test:safety`：**74/74**，0 失败/跳过，是单元/API的重叠子集，不累加为395项。
- 新增 E2E 共 **8**：工作台3、章节检查器5（含多作品统一备份往返）。覆盖创建/切章、编辑/保存/刷新、失败导航保护、组合事件、原生及模型选区、DOM不重挂载、关系图/档案、设定/剧情/时间线、真实关联写入、跨窗口版本冲突、双面板同步、主题/专注、Mock媒体播放/导出入口及多尺寸几何检查。
- 最终完整浏览器集合 **155**（原147+新增8）；Chromium/Firefox/macOS Chrome/WebKit 完整结果、运行链接和准确 HEAD 以 [PR #45 checks](https://github.com/shawnhhh/storyforge/pull/45/checks) 和 PR 正文最终验收表为准。本报告随源码提交，不把尚未结束的 CI 预报为成功。
- 本地完整 Chromium 第一轮开发期间出现一例创建章后回首页。已解压 trace，console 明确记录同刻 `/src/features/novels/Workspace.tsx` 热更新（新增 hook 导致 Fast Refresh 状态重置）；这次失败不算通过，源码冻结后单独复验并执行最终 CI。没有删除测试、放宽断言或自动重试掩盖失败。
- 完整本地单进程首轮146过/6失败/1未跑，触及原900秒全局预算；不记为通过。两项主题色/紧凑侧栏契约已按原断言修复；首页视频入口保留原行为，小说打开后使用“音乐创作/视频创作”常驻导航。资料取消删除失败trace显示在并行build期间发生dev重新加载，冻结后原断言通过。最终使用原CI的三个隔离分片执行全部用例，未提高超时或跳过失败用例。
- 统一备份错误已精准修复：新增多作品fixture暴露旧递归remap会将与ID同值的 `main/subplot` 类型、标题或正文误映射为UUID。仅在语义ID/引用键上重映射，已知JSON图结构容器继续递归处理；正文、类型枚举、提示词、备注和JSON样式文本逐字保留。服务回归保留合法碰撞ID（修复前1失败、修复后通过），检查真实引用重映射、源作品未变、恢复后再导出/预览以及外键完整。另有多小说E2E往返验证；测试种子与生产UI一致生成唯一ID，不把更换种子当服务修复。无schema变更。
- 本地首次 build 因沙箱禁止 `git` 子进程失败、首次单元因禁止监听失败；改用获准执行环境重跑。不是产品代码通过的替代声明。
- 本地 Firefox 下载两个官方地址均被网络策略403拒绝，实际 Firefox E2E 入口已执行，但因浏览器缺失启动失败；不计通过。使用仓库原 Firefox CI 获取真实结果。macOS Chrome/WebKit 仅由现有 macOS CI 执行。
- 拓宽费用确认工作流 paths，使共享样式、Music/Video 与首帧主题改动也触发原 macOS 费用回归；没有减少任何旧测试。

## 实际截图索引

24 张均来自运行中的 StoryForge + 隔离 SQLite/合成媒体，使用 Playwright 真实交互；不是静态设计图。人物姓名仅存在测试种子和截图中，产品源码没有演示名单。截图用于人工视觉审查；自动布局几何回归保留，未声称跨平台逐像素 golden 一致。

|界面|1440 浅色|1440 深色|1280 浅色|1280 深色|
|---|---|---|---|---|
|正文+人物档案检查器|[查看](apple-ui/novel-inspector-light-1440.png)|[查看](apple-ui/novel-inspector-dark-1440.png)|[查看](apple-ui/novel-inspector-light-1280.png)|[查看](apple-ui/novel-inspector-dark-1280.png)|
|人物关系图|[查看](apple-ui/character-relations-light-1440.png)|[查看](apple-ui/character-relations-dark-1440.png)|[查看](apple-ui/character-relations-light-1280.png)|[查看](apple-ui/character-relations-dark-1280.png)|
|世界观关联|[查看](apple-ui/world-links-light-1440.png)|[查看](apple-ui/world-links-dark-1440.png)|[查看](apple-ui/world-links-light-1280.png)|[查看](apple-ui/world-links-dark-1280.png)|
|剧情/伏笔/时间线|[查看](apple-ui/plot-links-light-1440.png)|[查看](apple-ui/plot-links-dark-1440.png)|[查看](apple-ui/plot-links-light-1280.png)|[查看](apple-ui/plot-links-dark-1280.png)|
|Music|[查看](apple-ui/music-light-1440.png)|[查看](apple-ui/music-dark-1440.png)|[查看](apple-ui/music-light-1280.png)|[查看](apple-ui/music-dark-1280.png)|
|Video|[查看](apple-ui/video-light-1440.png)|[查看](apple-ui/video-dark-1440.png)|[查看](apple-ui/video-light-1280.png)|[查看](apple-ui/video-dark-1280.png)|

## 实际修改文件

|文件|作用|
|---|---|
|`src/features/novels/Workspace.tsx`|三栏整合、目录与模块左移、工具栏、检查器独立挂载及busy聚合|
|`src/features/novels/apple-workspace.css`|小说桌面/小屏/专注布局、沉浸排版与旧dark规则覆盖|
|`src/features/story-bible/ChapterInspector.tsx`|真实人物/设定/剧情检查器、CAS关联、内联档案/关系图|
|`src/features/story-bible/chapter-inspector.css`|检查器标签、资料、SVG关系图与时间线样式|
|`src/features/story-bible/knowledge-events.ts`|仅广播同小说已确认关联快照|
|`src/features/story-bible/KnowledgeLinks.tsx`|旧资料引用面板与新检查器版本同步|
|`src/features/planning/PlanningPanel.tsx`|新增可选时间线初始入口，复用现有StoryTimeline|
|`src/shared/styles/apple.css`|全模块语义tokens、字体、控件、媒体工作台视觉|
|`src/shared/ui/ThemeControl.tsx`|统一浅/深/系统主题控件|
|`src/features/music/MusicWorkspace.tsx`|共享主题与模块导航|
|`src/features/video/VideoWorkspace.tsx`|共享主题与模块导航|
|`src/main.tsx`|加载共享设计系统|
|`index.html`|首帧主题解析|
|`tests/e2e/apple-workspace.spec.ts`|新增工作台、主题响应式与媒体回归3例|
|`tests/e2e/chapter-inspector.spec.ts`|新增真实关联、CAS、输入/选区、双面板同步及备份往返5例|
|`server/src/modules/backups/unified.ts`|只重映射语义ID/引用，保留类型与正文内容|
|`server/tests/unified-backup.test.ts`|新增合法ID碰撞及备份再次往返安全回归|
|`.github/workflows/studio-cost-confirmation.yml`|扩大费用确认回归的UI触发范围|
|`docs/acceptance/apple-ui/*.png`|24张实际应用截图|
|本报告|中文验收与文件/截图索引|

## Mac 仍需人工验收

原生 Safari（不是 Playwright WebKit）、物理中文输入法候选窗/连续组合、系统快捷键与屏幕阅读器、真实13英寸Mac的缩放/视网膜显示与触控板滚动。还需长时间写作/播放、大档案/媒体内存峰值、休眠恢复等设备验证。原生Safari、真实IME、Mac签名.app/DMG、1080p长视频、真实AI音视频质量及商业许可均未在本轮宣称通过或新增。
