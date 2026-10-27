# Video MVP 中文验收报告

## 功能与架构

本工作线基于独立小说候选集成与共享 Studio 基础设施，在 `feat/video-mvp-20261027` worktree 开发，不修改 main、原 PR 分支，不合并任何 PR。进入 `/#video` 使用视频工作台，小说仍为默认入口。

已实现视频项目创建、列表与重命名、剧本保存、完整历史版本及显式载入后另存；分镜可添加、移除、上移，包含独立 ID、描述、1–60 秒时长、运镜和 16:9/9:16/1:1 比例。前后端共同校验字段与版本，旧窗口保存返回冲突，当前未保存正文继续保留。切换项目、离开模块及刷新有草稿保护，本机草稿必须明确恢复，也可独立导出未保存草稿 JSON。

业务层 `shared/video/model.ts` 提供平台无关 VideoProviderAdapter 与 MockVideoAdapter，生成提示包含剧本、每镜配置与画面比例；共享 CreativeProvider 执行异步 Mock 任务，持久化 queued/running/completed/failed 及进度。项目切换使用当前 ID 与请求序号保护，迟到轮询不能污染新项目。

复用共享 SQLite 项目/历史/素材/任务、API generation、TaskProgress 与 AssetPreview。工作台支持系统主题、窄屏、图片/音频/视频导入和真实媒体控件预览；生成结果为有效的一秒 VP8 WebM 本地示例，明确标注 Mock，不声称按剧本渲染了成片。可导出原始视频/音频/图片，以及包含剧本、分镜、历史、任务和所有 base64 素材的完整工程 JSON。

## 数据隔离与边界

Studio 独立持久化为同 dataDir 下 `studio.sqlite`，不改变小说 schema 或原备份精确结构校验。小说备份恢复不会备份/恢复 Studio；请使用工程 JSON 导出保留项目与原始素材。MVP 未实现工程 JSON 导入、时间线剪辑、合成转码、真实付费视频 Provider 或原生平台外壳。前端素材上限 500 KB，服务端上限 650 KB，不适合长视频文件。

测试只创建临时 SQLite、虚构素材与 Mock AI，不打开真实 .env、用户数据库、真实备份或付费接口；生产构建沿用 `envDir:false`。没有新增依赖或修改原小说迁移。

## 自动化检查记录

- 定向单元与 SQLite 安全：5/5 通过，0 失败、0 跳过。包括视频提示词完整性/配置拒绝、SQLite 重开后字段一致、历史及冲突不覆盖、外键与 integrity_check、WebM 真实字节导出及项目素材隔离。
- 新增 Chromium 浏览器用例 6 项：1440px/390px 保存/重开/真实 Mock 视频播放/完整工程导出，素材导入与历史恢复，输入拒绝及旧版本冲突，本机草稿跨刷新显式恢复，跨项目迟到轮询隔离。最终完整 6/6 通过，0 失败、0 跳过、0 flaky；用时 19.8 秒。1440px/390px 深色截图保存在本次 E2E 工作目录。
- 完整单元/API：245/245 通过（43.7 秒），0 失败、0 取消、0 跳过。
- SQLite/迁移/回收站/备份/草稿/Studio/Video 综合数据安全专项：96/96 通过（4.9 秒），0 失败、0 取消、0 跳过。上述专项及 5 项定向均为完整测试的子集，不相加计数。
- 最终 lint、完整 typecheck、build 与 git diff --check 通过；代码验收提交 `20d1cb9af645183b06d834694110eed85abc118d`，随后仅追加本报告。

默认沙箱的 Node 测试只输出文件计数，未当作 5 条断言执行成功；使用获准测试执行权限重跑后实际输出 5 条独立 subtest 并全部通过。初次 typecheck 揭示单元夹具缺少完整 DTO，以及 E2E fixture 导入缺 NodeNext `.js` 扩展，均已修复；没有放宽生产类型。

浏览器失败与修复如实保留：第一轮记录 5 项失败后中止，React StrictMode 初次双 GET 与仅一次的拦截夹具冲突；改为同时暂停全部真实初始 GET，验证握手前确实禁用创建，再放行真实 API。第二轮记录 1 项失败后中止，第三轮记录 2 项失败后中止，分别发现 select 的 option 文本和 textarea 既有内容影响隐式 label 的 exact 定位；统一为全部动态编辑控件增加明确 aria-label，保留原标签、原断言和 45 秒期限。最终第四轮完整 6/6 真实通过。中止运行的未完成项目不冒充通过；失败 trace/截图仍在各独立 work/e2e-results 目录。

Safari/iPhone、真实系统中文输入法、原生媒体编码、长时运行与长视频均未验收。跨引擎结论以本工作线当前 SHA 的 CI 为准，不能用来源 PR 的成功替代。

本地最终证据：`/tmp/video-all-final.log`、`/tmp/video-safety-final.log`、`/tmp/video-complete-{lint,types,build}.log`、`/tmp/video-e2e-fourth.log`，浏览器 JSON：`work/e2e-results/1793066706640-15854/results.json`（expected=6、unexpected=0、skipped=0、flaky=0）。这些是本地临时证据，长期检查以 Draft PR #30 当前 head 的 GitHub Actions 为准；本报告不把旧 head CI 或来源 PR CI 当作当前 head 的通过证据。

实际执行顺序是：统一 aria-label 修复 → 完整 6 项浏览器通过 → 完整 245 项单元/API → 96 项数据安全 → lint/typecheck/build。全部测试与 `20d1cb9` 的代码和测试树一致，后续仅更新本报告。构建成功耗时 349ms（不含前置 typecheck）。

已实际查看最终 `video-workspace-390.png` 与 `video-workspace-1440.png`：深色主题层次、项目列表、表单、分镜卡片、任务进度、视频和导出控件均在视口内，390px 自动为单列且无横向溢出。截图位于 `work/e2e-results/1793066706640-15854/video-video-saves-script-a-2a5fe-ock-exports-and-reopens-390-chromium/` 和对应 1440 目录；视频播放已在同一用例重载之前通过 `media.play()`/paused=false 验证，截图记录重载后的媒体预加载状态。
