# PR #19 → #20 → #21 独立正式集成准备

本分支以 2026-10-26 重新读取的 main `1a6895f3c69c932b131554e380de6b5cd4d54a41` 为基线，依次集成：

- #19 `42aa114e5c6bf824d796c6d0fa2281618802ce16`：剧情、时间线、回收站、删除身份与恢复保护。
- #20 `249ba3a53ef8aa381be867c372a74eb6eab9c28d`：只读一致性审阅、主题与写作布局。
- #21 `df3599116eba47e0883ad2d5a02953c5a6520f22`：世界观、结构化人物、分卷/章节大纲的预览与明确确认新增。

三个源分支都基于 main，而非互相堆叠。#22 `173108fb0cdd77028074786aa243fac9a993aa0d` 只作已验收的组合解法与后续修复参考，不合并它，也不更新其分支。独立集成 PR 保持 Draft，禁止自动合并。

## 逐项冲突决策

先检查每个冲突的双方修改和自动合并区域，再借助先前组合提交 b8d6181 / ffd1d83 校对。它们提供的是双方功能的联合实现，不是 ours/theirs 任一侧的覆盖。现有组合测试是参考，当前新提交必须重新执行测试。

第一步集成 #19 没有冲突。第二步 #20 有以下两个文件冲突：

| 文件 | 双方意图 | 解决方法 |
|---|---|---|
| `.github/workflows/ci.yml` | #19 保留迁移/回收站/恢复专项和保存失败压力；#20 添加主题、审阅和真实 Chrome 通道恢复 | 合并两组检查，保存队列与失败草稿都重复五次；unit、完整套件的重复步骤只保留一次；always-upload 证据 |
| `tests/e2e/draft-recovery.spec.ts` | 两方都要求独立 profile 使用选择的浏览器，但 Chrome channel / executable 组合写法不同 | 独立 `chromiumOptions` 同时保留 channel 和可选 executable；保持 PID、崩溃、恢复和保存断言 |

第三步 #21 在真实中间结果上有十个冲突文件（上面两个路径在本步再次冲突，共十个不同路径）：

| 文件 | 双方意图 | 解决方法 |
|---|---|---|
| `.github/workflows/ci.yml` | 已有安全/审阅/主题回归；新规划 Mock、IME、性能、Firefox | 全部保留，使用 #22 已验证的 Chromium/Firefox 三片独立 runner、单 worker 和完整用例集；macOS Chrome/WebKit 均完整跑，保留专项/重复检查及 Artifact |
| `server/src/modules/ai/context.ts` | 审阅逐来源回调；规划按作品、按 ID 读取以避免整库加载 | preview 委托 previewNovel 并继续传 onSource；metadata 目录与点读保留，正文排除当前章；新增 reference 包装保留原 404 引用语义，不吞其他错误 |
| `server/src/modules/ai/routes.ts` | 只读 review 共用 execute；规划要拿到 provider 结果解析并保留预览 | 一个 router、一个 ledger/active/execute；execute 返回结果给各入口处理；保留 review 校验与只读结果、planning fingerprint 去重/取消/超时/预算/显式 save，禁止另建预算实例 |
| `server/src/modules/planning/store.ts` | #19 使用规范化人物/世界/章节链接和归档；#21 流式摘要、点读及分组性能 | 分组同时包含章节、人物、世界；readRecord 从链接表重建，snapshot 读事务保持一致；保存的 archiveRemoved、删除 ID 拒绝和版本保护不变 |
| `server/src/modules/story-bible/store.ts` | 关系删除归档；createHash 版本摘要和单条 DTO | 同时保留 archiveRemoved/snapshot 与 createHash；写入事务保留关系快照；返回普通对象 DTO，保留点读和摘要 |
| `src/features/planning/PlanningPanel.tsx` | 时间线/关联跳转和 assertPlanningRecovery；AI 保存后重载/焦点 | 同时传递 onOpen、focusAi；AiPlanning 在未保存或草稿阻断时禁用；保留 generation/基准检查，保存后仅刷新原规划，不替换正文 |
| `tests/e2e/draft-recovery.spec.ts` | 既有严格恢复与 Chrome 设置；新 Firefox profile | 按 browserName 选择三引擎；仅 Chromium 接收 channel/executable；保留全部恢复断言及失败生命周期附件 |
| `tests/e2e/focus-writing.spec.ts` | #19 验证完整 DOM/模型选区与 confined；#21 等待进入专注状态与真实全选 | 两者并存：等待 focused、输入焦点，再用原生全选并确认 DOM+模型全文范围；保留精确正文、失败保留、重试与切章回读 |
| `tests/e2e/run.ts` | 两方都避开 macOS Undici EINVAL，但健康轮询实现不同；#21 加 Mock 隔离 | 使用 node:http 本地轮询及原超时；保留 Mock 参数、随机端口、独立 SQLite/备份、AI 环境剥离、每套件独立产物、子进程退出清理与服务日志 |
| `vite.config.ts` | #19 所有构建都不读 .env；#21 production/E2E 判断及编辑器预打包 | 用 command===build 或 E2E_BASE_URL 判隔离，保持 envDir=false；保留 @tiptap/pm/history 预打包，避免活跃草稿时 Vite 重载 |

## 有意携带的集成修复与回归

另行审核并携带已在 #22 验收的相关文本补丁，而非合并 #22：规划删除菜单移至关联资料异步加载前的稳定位置；菜单打开状态严格断言；父纲删除、子纲提升、链接目标保留、原 ID 回收恢复、旧草稿 409 与 SQLite 完整性检查；引用错误语义、源编辑器就绪和原生 DOM/模型选择检查；失败 page close/crash/disconnect 附件及监听器清理。均保持原测试断言和截止时间。

保留新世界生成→一致性引用→删除失效→原 ID 恢复的跨模块测试，以及写作/规划/审阅共用预算的 API 回归。历史文档与原始分支证据保留，不把旧报告的通过数作为当前结果。

基础迁移 0001–0006 与 planning_001–002 均与 #19 一致；不创建平行数据结构、不降级 schema、不删迁移记录。正式验收只运行临时 SQLite、隔离浏览器和 Mock Provider，不打开既有用户 data、备份或 .env。

## 验证方法与结果口径

以下是当前分支要求执行的命令，不是通过声明。实际 SHA、结束状态、数量、失败根因和 Artifact 链接以本 PR 描述及独立验收报告为准。专项与完整套件有重叠，不相加为独立用例。

```sh
npm ci
npm run lint
npm run typecheck
npm run build
npm test
node --import tsx --test server/tests/trash*.test.ts server/tests/planning-timeline.test.ts server/tests/planning-migrations.test.ts server/tests/restore-crash.test.ts tests/unit/draft-protection.test.ts tests/unit/planning-recovery.test.ts
npm run test:e2e -- --project=chromium
npm run test:e2e -- --mock-planning --project=chromium
# CI: Chromium/Firefox 各三片，macOS Chrome/WebKit 完整套件及专项。
```

分片保留 45 秒单项、7 秒断言、900 秒套件、单 worker 与 fail-fast=false；各片独立数据库和服务。三片用例集合必须完整、唯一。浏览器诊断保留七天，性能 JSON 十四天，审阅前下载原始失败与当前成功证据。

原生 macOS Safari、真机 iPhone、系统中文输入法与真实付费 AI 始终待人工；Playwright WebKit、合成 composition 和 Mock 不能替代。历史 WebKit 在备份恢复 API 前发生页面关闭，后续未再复现但根因未定，继续保留为稳定性风险。大库数据性能仅为单进程测试，不代表低内存设备、冷盘、峰值或长期并发。

### 本轮失败调查与测试时序修复

本地 2 核/8 GB 容器最初同时启动三个完整 Chromium 分片和 Mock 套件。原始日志保留：大库分卷保存 9380ms 超过原 3000ms；浏览器出现 45 秒单项和 900 秒全局超时。不能将这些失败写成通过，也不能以 CI 通过抹掉它们。后续本地改为顺序执行，原断言和预算不变，分别记录结果。

另一个失败具有明确请求证据：空标题草稿恢复成功，但恢复动作会再次提交空标题，trace 中恢复前后各有一个 400，补全标题没有发出 PUT。测试在恢复后的 400 仍在途时输入新标题，触发了已由单元测试明确保护的“失败请求取消排队自动重试”行为。现先等待该具体 PUT/400，核对请求标题确实为空，并等待 UI 失败状态，再输入补全标题。原正文恢复、补全标题自动保存断言完全保留，新增请求与状态断言；不改变生产保存队列、不自动重试失败写入、不延长截止时间。最新提交的完整回归需重新执行。

## 回滚与审核门槛

本轮仅准备独立 Draft PR，不执行任何合并。每个集成提交保留源 PR 父链，便于逐阶段审阅。CI 或人工验收失败时，只在本分支修复并重新测试最新 SHA。

将来发布前记录基线/发布 SHA、schema 版本与经恢复演练的一致性备份。活跃 WAL 下禁止只复制 .sqlite；使用 SQLite backup API 或应用完整备份。故障先暂停写入、保留 SQLite/WAL/SHM 和浏览器草稿现场，在副本复现，优先兼容新 schema 的前向修复。

代码如需撤回，按后续修复→#21→#20→#19 反序审核 revert；merge commit 先确认第一父链。代码 revert 不会降级数据库，v5/v6 库不能直接交给 v4 构建，禁止删除迁移行或表。需要恢复旧兼容快照时，先保全发布后写入并在副本验证导出/补录，任何用户数据替换须另外人工确认。本轮不执行上述数据操作。
