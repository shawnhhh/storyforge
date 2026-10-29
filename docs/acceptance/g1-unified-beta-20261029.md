# StoryForge G1 统一测试版候选：来源、数据安全与验收矩阵

> 创建于 2026-10-29。状态：**Draft 候选，非正式发布；当前 G1 PR 自身 CI 结果以 GitHub Actions 实时记录为准。**

## 1. 不可变来源基线

- main: `1a6895f3c69c932b131554e380de6b5cd4d54a41`（本次创建前核对，未修改）。
- F / #43 head: `472c0df29889b8a223471591ba2518789f686435`。
- 通过 GitHub compare API 对 #35、#36、#37、#38、#39、#40、#41、#42 逐一比较至 #43：全部 `status=ahead` 且 `behind_by=0`，这些 head 均是 #43 的祖先；main→#43 同样 `behind_by=0`。
- main→#43 当时领先 107 个提交、涉及 216 个文件；继承原提交链即可，**不得重复 cherry-pick、强制推送、合并来源 PR 或重建数据库**。
- 初始门槛提交 `2c9872caa3b3625f62274ad86bd9f8887cbdb44c` 相对 #43 仅增加此文档。后续必要修复、安全启动器与验收说明只追加到G1分支；准确SHA和每次CI见PR #44正文。来源 PR #35–#43 及 main 保持不变。

## 2. G1 可交付范围与明确限制

本轮重新读取的来源HEAD（没有修改这些分支）：

|来源|准确SHA|状态|
|---|---|---|
|#35|`b94d1ab9d9dc6b8dea382c9d050847453e95407e`|Draft，未合并，祖先关系已核实|
|#36|`bc3937f95b42df9d0fdffcae8d5d023e50924c51`|Draft，未合并，祖先关系已核实|
|#37|`42c2068b152f1a433957f7e8cc8225c30efc6194`|Draft，未合并，祖先关系已核实|
|#38|`15e95120042f0b7f2087e8fa5b21994214400d4b`|Draft，未合并，祖先关系已核实|
|#39|`b165dc514692001550ea6ad413b3e5d9fac1f04b`|Draft，未合并，祖先关系已核实|
|#40|`924398015404ac22a6ca3a2d4ff43e1c865368c8`|Draft，未合并，祖先关系已核实|
|#41|`3ced43107ecd55b86c3c641f92609521ce1ef366`|Draft，未合并，祖先关系已核实|
|#42|`7770097a917e5567e934c91d4e8fc153b2387197`|Draft，未合并，祖先关系已核实|
|#43|`472c0df29889b8a223471591ba2518789f686435`|Draft，未合并，祖先关系已核实|

`git merge-base --is-ancestor`逐一返回0；初始G1是#43的直接后继、main左侧0/右侧108个提交，diff仅一份验收文档。新增修复保留这条父链，不重复移植来源代码。

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

## 7. 本轮实际发现与修复（精确最终证据在PR正文）

初始G1 [Hailuo运行40814966066](https://github.com/shawnhhh/storyforge/actions/runs/40814966066) 的Chromium job123254106839和macOS Chrome job123254106892均失败：保存单镜头配置时，父组件按project.version重建面板，清空正在编辑的模型和提示词，生成按钮持续禁用。用延迟PUT稳定复现，读取本地失败截图/trace确认清空。云端原始artifact12871269552已保留，其文件服务下载地址被当前代理403拒绝，未声称已读取云端截图/trace。修复保持同一project.id面板，新增延迟保存期间输入及保存后保留断言；成功发布、截断拒绝和不覆盖原稿断言不变。未增加测试超时或跳过。

初次生产依赖审计报告3项：body-parser/express高危依赖链及qs中危。审计的fixAvailable:false并不证明没有补丁；另查npm注册表确认body-parser2.4.0、qs6.17.1已发布，按原有兼容范围更新锁文件，重新npm ci后`npm audit --omit=dev`为0项。关闭本地接口不用的压缩JSON解析，所有三处解析器保留原大小限额并设置inflate:false；请求级测试验证gzip及尾随字节均415、无写入，正常identity JSON仍可用。query parser显式simple，无qs.stringify调用。此结果只覆盖当时的生产依赖审计数据库，不保证不存在未知漏洞。

G2新增`scripts/beta.ts`与8项临时目录测试，覆盖linked/detached/全新路径、正式路径及Mac大小写/Unicode保护、符号/硬链接、SHA/端口、环境隔离、WAL/外键/CAS/运行锁，以及真实本地生产预览的首启写入/关闭/重启。`npm run test:safety`把现有跨库恢复、故障中断、Studio导入、幂等、任务/预算、媒体/引用和beta启动集中复验；它是完整单元/API的子集，不重复相加。

本地完整Chromium首轮另有工作台创建对话框失败（55过/1失败）。读取截图和trace后，Vite服务日志确认它把Playwright在work目录写入的诊断HTML当成页面修改，连续触发full reload，导致保存时导航、表单丢失。修复只排除work/data/dist生成目录的文件监听，保留trace及所有原断言；新增浏览器用例在未保存表单期间连续写入合成HTML，要求无导航且输入保留后可保存。修复后要重跑完整分片，不把失败首轮计为通过。

在d150514五组CI均通过后，保留成功用例trace复查React警告，确认Hailuo稳定面板与大型媒体面板使用相同工程ID作为兄弟key（本轮保持面板的修复引入）。网络响应的工程ID与警告一致。改为hailuo:前缀保持稳定且不冲突；联动afterEach增加重复key零警告断言，修复前4/4失败、修复后4/4通过。没有忽略console警告或删除原测试；最终HEAD仍需完整复验。

[G2 Mac安装、启动、回退、恢复与原生人工清单](g2-mac-beta-guide-20261029.md) · [G3候选交付及完整验收报告](g3-mac-candidate-20261029.md)。云端自动化不代替原生Safari/iPhone/物理IME/硬件故障人工签字。准确最终SHA及五组CI固定在PR正文，不沿用旧head结果。
