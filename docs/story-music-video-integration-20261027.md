# StoryForge 小说、音乐、视频联合集成（待 CI 验收）

- 来源：#27（小说集成）→ #28（Studio）→ #29（Music），并整合 #30（Video）。
- 基线 SHA：#27 `1d742014`，#28 `1a92484`，#29 `8c149cb`，#30 `e28add2`。
- 采用新的独立 Draft PR，不修改来源分支或 `main`。
- 解决共同修改的 `src/App.tsx` 导航冲突：小说首页同时显示 Music/Video 侧栏入口，取消悬浮覆盖；保留 Music dirty 离开保护和 Video cancelable leave 事件。
- 增加 390/700px 三模块导航回归。完整测试及 CI 尚待执行，不能用原 PR 各自绿色结果代替本集成通过。

## 安全与限制

- 数据库：小说原 SQLite 与 Studio 的 `studio.sqlite` 分离；小说旧备份**不包含**音乐、视频数据。
- Studio 项目导出含素材、历史与任务元数据，但 MVP 暂未支持项目导入，亦无跨库原子备份。
- Music/Video 仅 Mock 生成，不代表真实歌曲、视频服务已经接入。
- 不得在真实用户数据库中执行破坏性测试；验证必须使用隔离 SQLite、临时素材与 Mock。
- 待办：完整 lint/typecheck/build、单元/API、草稿/SQLite 安全、Chromium/Firefox/macOS Chrome/WebKit E2E，特别关注多个工作台入口、未保存内容离开阻止及长篇写作按钮不被遮挡。
- 当前阶段仅创建集成候选，未正式验收，不建议合并。
