# StoryForge 云端续验记录（2026-10-27，持续更新）
集成分支 integration/studio-recovery-20261027；当前提交 2bc1ab986d1ceb20bb19059ed9fdb13829075e8b。
基于上次已推送的修复 58fe05771850a74e2ce152b510d52420193595e0，不重新开发功能。
新增提交仅加入冻结 v2 schema 的迁移/失败回滚测试，无生产功能重写。

## 冻结来源与依赖
| PR | SHA | 关系 |
|---|---|---|
| #31 | a4d2408b113e57978809d454d587dae6d6b72520 | 三模块基线，base main |
| #32 | e6d4891cb2947d021313909280b719cae9e05a0f | 基于 #31，Studio schema v2 |
| #33 | cd848d1553387df27ee01e264e5de2f36c94defd | 基于 #31，与 #32 平行 |
| #34 | f262698f91a1d029d566c93d879d8856423a22e6 | 基于 #31，已 cherry-pick #32 等价代码，Studio schema v3 |
#34 的 003cb29/e85b825 与 #32 f0cb947/e6d4891 为等价补丁；
#33 的 81b882f/cd848d1 在修复分支复用为 40ddc1d/554352a。
58fe057 显式等待 Music URL 回退、放弃编辑完成及 Video 取消确认，无 sleep、删测试或放宽超时。

## 原始失败
https://github.com/shawnhhh/storyforge/actions/runs/40471551862/job/122079533919 ：Chromium 3/3，41 passed / 2 failed（43 总数）。
studio-import.spec.ts Music 拒绝 hashchange 后，测试过早放弃编辑并设置同一 hash，未产生预期导航。
video.spec.ts 取消导航弹窗尚未处理完就注册刷新 accept，触发 already handled。
Artifact https://github.com/shawnhhh/storyforge/actions/runs/40471551862/artifacts/12719092844 （平台保留期有限）。

## 本轮本地实测
环境 Node v24.19.0、系统 Chromium 154.0.8037.57，不能冒充 CI 使用的 Playwright Chromium 156。
- 两个失败用例各 repeat-each=5：10/10，0 失败/跳过。
- music/studio-import/studio-integration/video/unified-backup 相关回归：16/16，0 失败/跳过。
- studio-draft-navigation：1/1，0 失败/跳过（上面 16 项未包含此项）。
- 原工程导入与统一备份：13/13 通过（初次同一命令还包括两个新迁移用例，因夹具错误 2 失败，不能称初次 15/15）。
- 新迁移专项纠正夹具后：2/2，0 失败/跳过。
- 隔离执行 #32 真实 v2 opener 拒绝 v3、随后 v3 可重开：1/1 一次性断言脚本。
- lint、typecheck、build 成功。
重复压力测试与相关回归有重叠，不相加冒充不同用例。没有重跑已成功且无代码变化的本地完整套件。
首次浏览器运行 10 项均因缺少 Playwright executable 而启动失败，未验证功能；默认浏览器安装目录不可写。随后使用系统 Chromium 实测并如实单列。
迁移测试开发阶段的两次失败为 importer 实例未复用、故障注入及错误消息匹配问题，已纠正夹具；没有以这些失败改动生产代码。

## 数据兼容结论
真实 v2 schema 来自冻结 #32 源码，含已有工程、历史、BLOB 和导入收据。
升至 v3 后原行完全相等，原导入仍拒绝重复；两张 unified 表为空；反复开启/外键/integrity_check 成功。
在创建 unified_drafts 前注入同名索引故障，迁移失败后版本仍为 v2，新建 unified_restores 回滚，原作品保留。
v2 程序明确拒绝 v3；代码回退不等于数据库降级。禁止用 #32/#33 旧程序直接打开已迁移库。
仅使用临时 SQLite/Mock，不读取真实用户库或 .env，不调用付费模型。

## CI 与后续动作
当前集成提交新 push CI：https://github.com/shawnhhh/storyforge/actions/runs/40475054830 。
尚未全部完成，不能标为通过，也不能把来源 261/261 当作新提交全量结果（新提交新增 2 项，预期 263，实际以日志为准）。
来源 head 的全部 push/PR run 与 job/step 快照：source-ci-snapshot.json。
#31 PR 40468150712 为9/9成功，push 40468060905 为8成功1失败。
#32 PR 40470758977 的Linux7成功、macOS2排队；push40470753601 的Chromium3失败。
#33 PR40471423799/push40471419808仍有执行中/排队，尚无全绿结论。
#34 PR40471551862 为6成功1失败2排队；push40471413294 尚有执行中/排队。
来源状态为采样时刻，最终以 GitHub 实时状态为准。

按用户要求：等待当前集成 SHA 所有 CI job 完成并检查日志，再创建新的独立 Draft 集成 PR（base main，head integration/studio-recovery-20261027），不合并、不修改来源 PR。
若环境中断，从此提交与 run 恢复，勿重复已成功本地测试。没有创建 PR 前不要声称已创建。
剩余风险：macOS CI 排队/未执行；真实Safari/IME设备、硬件断电、磁盘满未验收；128MiB 备份/64MiB工程限制；草稿只恢复到独立收件箱需手动核对；SHA-256非认证/加密。

## 最新核验（2026-10-27 08:54:50 UTC）
集成 push CI 7/9 job completed/success；macOS Chrome job122091128584、WebKit job122091128636 仍 queued，runner_name为空。未执行，不算通过。
| 项目 | 实际结果 |
|---|---|
| 单元/API | 263 passed、0 failed、0 skipped |
| 数据/迁移/草稿安全专项（上项子集） | 86/86 |
| Chromium 完整三分片 | 52 + 42 + 44 = 138/138 |
| Firefox 完整三分片 | 52 + 42 + 44 = 138/138 |
| Chromium 主job附加专项 | IME 2、主题2、崩溃恢复重复3、规划草稿32、写作焦点66、AI Mock规划17、移动恢复重复10、删除与迟到资料重复10，均通过 |
| Firefox 附加专项 | IME2、AI Mock规划17、写作66、移动恢复重复10、删除与迟到资料重复10，均通过 |
专项、压力重复与完整套件有重叠，不累加为新增唯一用例。CI准确数量均读取已完成 job 日志，而非预测。

CI链接：https://github.com/shawnhhh/storyforge/actions/runs/40475054830 。各job链接及计数见同目录 studio-recovery-integration-ci-20261027.json。
远端 main 与 #31/#32/#33/#34 已重新 ls-remote 核对，与冻结 SHA 相同。四个来源 PR 继续 Draft，未修改/合并。

当前没有创建新集成 PR：用户要求全部 CI 验证后创建，macOS 尚未执行，因此前置条件未满足。没有通过取消来源任务、修改workflow或跳过macOS来伪造全绿。
本记录独立保存到 acceptance/studio-recovery-checkpoint-20261027，文档提交使用 [skip ci]，仅为避免文档副本重复触发完整测试；集成代码分支及其被测SHA不变。

### 下次直接续跑
1. fetch integration/studio-recovery-20261027 并核对 head 为 2bc1ab986d1ceb20bb19059ed9fdb13829075e8b；不重复 cherry-pick，不重跑已成功本地套件。
2. 读取 run40475054830 的 macOS 两job。queued/in_progress/timeout不能标通过；若失败，读取失败步骤/trace再定向处理，不重跑成功Linux job。
3. 当前 head 全部9个job成功后，用 integration/studio-recovery-20261027 为head、main为base创建独立Draft PR。正文链接本报告及准确代码SHA，不合并main或任何来源PR。创建PR会按现有workflow产生PR事件CI，应记录新run，不能冒称其已完成。
4. 如需修代码，在集成分支追加提交，仅跑失败专项及必要回归并检查新CI。不要把本报告分支作为功能head或重复引入来源补丁。

