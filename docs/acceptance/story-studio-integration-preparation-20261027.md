# StoryForge 三模块 + Studio 工程导入 + 导航保护 + 统一备份：集成准备审查

日期：2026-10-27。状态：**仅准备分支，尚未完成最终验收，禁止合并**。

## 来源与校验基线

- #31 小说 / Music / Video 三模块基线：`a4d2408b113e57978809d454d587dae6d6b72520`，PR CI 9/9 success。
- #32 工程导入：`e6d4891cb2947d021313909280b719cae9e05a0f`，GitHub Actions `40470758977`；核查时 8/9，macOS Chrome 排队。
- #33 未保存导航保护及视频确认框修复：`cd848d1553387df27ee01e264e5de2f36c94defd`，GitHub Actions `40471423799`；核查时 8/9，macOS WebKit 执行中。
- #34 三模块备份：`f262698f91a1d029d566c93d879d8856423a22e6`，GitHub Actions `40471551862`；核查时 6/9，通过的并不包括失败的 Chromium 第三分片，且 macOS Chrome/WebKit 尚未完成。

CI 状态为核查时快照，可能变化。只有 **本准备分支最新 SHA 对应的实际 CI** 才能证明组合结果；来源 PR 结果不能替代联合验收。

## 静态冲突审查及本准备分支合成策略

1. 以 #34 文件树为工作树基线：保留 #32 工程导入和 #34 v3 统一备份的数据服务、路由、回滚、SQLite 迁移；不回退 v3 为 #32 的 v2。
2. 比对 #32/#34：MusicWorkspace、VideoWorkspace、ImportPanel、Studio import.ts、routes.ts、导入 E2E、导入中文报告文件 blob SHA 一致。差异的 database.ts 是 v3 升级，不应使用 v2 覆盖。
3. 从 #33 移入 `src/App.tsx`、`src/features/novels/Workspace.tsx`、`tests/e2e/video.spec.ts`、`tests/e2e/studio-draft-navigation.spec.ts` 和导航修复报告：维持视频弹窗竞态修复、小说未保存内容离开阻止。
4. 本准备分支提交保留 #34、#33、#32 祖先信息；不变更来源分支、`main`，不启动合并。

## 强制验收门槛

- 等 #32、#33 的 macOS 任务全部结束并成功；#34 原提交 Chromium 第三分片失败必须有清楚的修复和重新验证记录，不能抹除历史失败。
- 准备分支自身 lint、typecheck、build、完整单元/API、数据安全与恢复、Chromium/Firefox/macOS Chrome/WebKit E2E **全部通过**，同时复核测试对应本分支实际 SHA。
- 校验隔离 SQLite v2→v3 的迁移、旧版本拒绝新 schema 的数据不变性、损坏包拒绝、媒体素材缺失、跨库备份恢复回滚、重复导入、小说未保存页面跳转阻止，以及 Studio 导入后再统一备份恢复。
- 无失败、跳过或超时掩盖；记录准确数目与日志，特别保留 #34 原失败 `40471551862` 证据。
- 真正 Mac Safari / iPhone / 中文 IME / 断电 / 磁盘满 / 真实付费 AI 接口仍未实际验收，不得宣称通过。所有自动化使用临时数据库、素材与 Mock AI，不接触用户真实数据库或付费接口。

## 数据安全保留条款

- 备份、恢复测试必须在隔离路径执行；禁止将真实小说 SQLite、studio.sqlite、WAL/SHM 作为测试目标。
- 统一备份上限 128MiB，浏览器草稿恢复进独立收件箱且由用户确认采用；本机全局偏好与写作计数不得被覆盖。
- 该分支是候选代码树，**没有完成实际测试前不能视为可发布**。
- 最新完整 CI 全绿并审查报告后，才考虑从此分支建立独立 Draft 集成 PR；不得修改 #31–#34 源分支或 `main`。
