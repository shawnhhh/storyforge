# StoryForge G1 统一测试版候选：来源、数据安全与验收矩阵

> 创建于 2026-10-29。状态：**Draft 候选，非正式发布；当前 G1 PR 自身 CI 结果以 GitHub Actions 实时记录为准。**

## 1. 不可变来源基线

- main: `1a6895f3c69c932b131554e380de6b5cd4d54a41`（本次创建前核对，未修改）。
- F / #43 head: `472c0df29889b8a223471591ba2518789f686435`。
- 通过 GitHub compare API 对 #35、#36、#37、#38、#39、#40、#41、#42 逐一比较至 #43：全部 `status=ahead` 且 `behind_by=0`，这些 head 均是 #43 的祖先；main→#43 同样 `behind_by=0`。
- main→#43 当时领先 107 个提交、涉及 216 个文件；继承原提交链即可，**不得重复 cherry-pick、强制推送、合并来源 PR 或重建数据库**。
- G1 候选分支仅在 #43 之上新增本验收文档，功能代码保持原有已测试状态。来源 PR #35–#43 及 main 保持不变。

## 2. G1 可交付范围与明确限制

| 模块 | 当前候选覆盖 | 限制 / 未验证 |
|---|---|---|
| 小说创作 | 中文编辑、章节、大纲、角色/世界观、版本和草稿保护 | 真实 Safari/iPhone 中文 IME、设备断电未验收 |
| Music | 工程和素材、持久化任务、Music3 协议适配和 Mock 回归 | 没有真实自托管 GPU 音质、实际付费/商用许可验证 |
| Video | H3 单镜头协议适配、结构化来源、安全下载、CAS | 没有真实 Hailuo 付费生成、真实视频许可和服务端长期渲染验证 |
| 多轨联动 | 章节→可编辑分镜→视频任务关联→音频/字幕多轨预览→短 WebM 导出 | 目前 Mock；导出最多 30 秒、640×360、15fps；不保证逐帧同步 |
| 数据与安全 | SQLite 迁移、跨库备份恢复、任务/素材重映射、费用预算与下载约束 | 极大档案、磁盘满、硬件断电、长期性能仍需实测 |

## 3. 已有自动化证据（#43 已核实，G1 要复验自身新 SHA）

- [#43 完整 StoryForge CI：9/9](https://github.com/shawnhhh/storyforge/actions/runs/40807418870)：四浏览器完整 E2E 各 146/146；单元/API 311/311。
- [联动专项：4/4](https://github.com/shawnhhh/storyforge/actions/runs/40807418851)。
- [Hailuo 协议专项：4/4](https://github.com/shawnhhh/storyforge/actions/runs/40807418793)。
- [Music3 协议专项：4/4](https://github.com/shawnhhh/storyforge/actions/runs/40807418845)。
- [费用确认专项：2/2](https://github.com/shawnhhh/storyforge/actions/runs/40807418856)。
- 以上五项均为 #43 提交的历史证明，**不能代替 G1 PR 对新 commit SHA 的 CI**；不能将排队/取消/未运行标为通过，也不能重复累加重叠测试数量。

## 4. 跨阶段数据迁移与失败回滚核验路径

以下为 G1 CI 必须继续执行的仓库既有自动化用例（代码路径应保留，不得删除/跳过）：

1. `server/tests/studio-integration-safety.test.ts`：Studio v2→v3 升级保留作品、素材、历史和 receipt；拒绝未来 schema，保证旧数据不变。
2. `server/tests/unified-backup.test.ts`：WAL 快照及模块选择性恢复、跨 SQLite 全量恢复失败回滚、损坏包和漏失素材拒绝、重复恢复幂等；长历史和媒体字节对比。
3. `server/tests/restore-crash.test.ts`：模拟恢复进程中断后，重启仍保留原 WAL 数据。
4. `server/tests/studio-import.test.ts`：版本/路径/素材/历史校验失败零写入；SQLite 错误回滚并可重新预览。
5. `server/tests/studio-jobs.test.ts`：重启恢复、不重复提交、租约、取消、超时退避和签名 Webhook。
6. `server/tests/composition.test.ts`：章节生成预览不改原稿；显式确认与来源版本绑定；跨工程任务/媒体引用；恢复时重映射；漏选模块整批回滚；任务关联失败后预算预留同步回滚；CAS 活跃与历史引用保护。
7. `server/tests/studio-safety-costs.test.ts`：费用确认、预算、安全下载和失败处理相关测试。

### G1 接受标准

- G1 PR 的 lint / typecheck / build、完整单元/API、Chromium 三分片、Firefox 三分片、macOS Chrome、macOS WebKit 共 9 个 Job 全部 success，来源及实际 checkout SHA 逐项核对。
- Composition、Music3、Hailuo、费用专项按照 GitHub 已配置的独立工作流再次验证；以各自对 G1 HEAD 的运行结果为准。
- 数据安全用例使用 GitHub Actions 的隔离临时 SQLite、Mock 供应商、合成素材；**不使用真实用户库、真实密钥或付费 API**。
- 所有失败的原始 Job、日志、截图、trace 与修复前 SHA 均保留；不能以放宽断言、跳过错误用例冒充通过。

## 5. Mac 测试版人工验收（G2，未完成）

- 在**独立 git worktree** 和独立临时数据目录启动 G1 候选，不直接用真实 `~/Developer/storyforge/data`；测试前另行核验默认数据库路径和环境变量。
- Safari：创建测试小说/章节、中文输入法组合输入、长文本自动保存、切换章节拦截、退出重开恢复。
- Studio：创建 Mock 音乐与视频、试听、上传下载、分镜草稿预览→确认、字幕/配乐多轨短片导出和解码。
- 生成完整统一备份，做副本恢复并核对来源 ID、音乐/视频素材、任务历史、同名冲突及 SQLite 完整性；原库保持只读核验。
- 模拟超大媒体与磁盘临界状态须在专用测试目录/设备进行；不要在含有真实资料的机器上破坏性测试。
- 有真实服务商和预算授权前，**不得使用真实付费 Key 或宣称模型音质/效果已验证**。

## 6. 结论规则

- PR 仅用于 **G1 完整候选代码集成与自动验收**，创建/CI 全绿不代表已可合并 main。
- G1 CI 全绿后标记“云端集成候选通过”；G2 原生设备数据与输入验收未完成前继续 Draft，不合并。
- 如 G1 PR 新发现失败，在 G1 独立分支修复并复验；禁止修改 #35–#43 或 main。
