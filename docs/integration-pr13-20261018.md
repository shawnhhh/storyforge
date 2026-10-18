# PR #13 第一阶段集成记录

## 基线与范围

- 远端 main 与现有集成分支起点：`1a6895f3c69c932b131554e380de6b5cd4d54a41`。
- 集成分支：`integration/storyforge-planning-trash-20261018`；PR #13 头：`8ab0f40fd76da27c8533b9730c17c010a01f9267`。
- 使用指定分支的干净工作树；未读取原目录 `.env`、真实作品 SQLite 或备份。测试固定使用临时 SQLite/备份目录及 Mock AI。
- 仅集成 PR #13，保留 main/PR #18；没有引入 PR #15，没有修改原始 PR 或 main。

## 冲突与兼容

唯一 Git 文本冲突位于 `src/features/planning/PlanningPanel.tsx`，逐块合并：

- 接入人物/地点引用、时间线及 `onOpen` 资料导航。
- 保留 PR #18 IndexedDB/同步日志草稿保护、旧草稿迁移、显式恢复、候选草稿阻塞、失败导出和保存队列。
- 保留组合输入期间暂停自动保存、版本冲突停止写入、恢复时采用当前规划版本及 HTTP generation 校验。
- `Workspace.tsx` 保留专注写作和队列，只新增资料跳转回调；Tiptap、弹窗焦点、章节编辑器及选区实现未改动。
- 时间线 E2E 改为先检查阻塞及数据库未被写回，再显式恢复；保留并增强人物、地点和章节数组断言。

## 数据库与备份

- 只追加 `planning/002`；基础 v1–v4 和已发布 `planning/001` SQL 无变化。
- 新表 `planning_character_links`、`planning_world_links` 使用复合外键约束作品范围；删除目标时清理引用并提升规划版本。
- 关联无效、跨作品、重复关联、保存故障均在事务中拒绝或回滚。
- 备份按基础版本与 planning 版本组合校验精确结构，支持两种历史 v3、planning 0/1/2；历史备份只在私有副本升级，原文件字节保留。
- 恢复事务覆盖新增表，恢复前安全快照包含新引用；失败恢复回滚，成功恢复更新 generation。
- 本地迁移、备份恢复、崩溃恢复和草稿保护专项：24 通过、0 失败、0 跳过。

## 本地验证及环境阻塞

- lint、TypeScript typecheck、build 均已通过。
- 完整 `npm test` 在默认沙箱返回 10 个测试文件通过、11 个文件失败、0 跳过；这是文件级汇总，不能当作全部单元用例数。涉及本地服务的测试受网络沙箱限制，最终以 CI 用例结果为准。
- E2E 专项启动在分配本地端口时报 `listen EPERM 127.0.0.1`，没有浏览器用例执行。停止本地服务重试；没有删除断言、跳过测试或放宽超时。
- GitHub Actions 在 Linux、macOS Google Chrome 和 macOS WebKit 执行 lint/typecheck/build、完整单元/API、规划/时间线/草稿专项及完整 E2E；具体运行链接和最终数量将在验证后记录。WebKit 自动化不等同于手动 Safari 中文输入验收。
