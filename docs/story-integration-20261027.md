# 小说集成候选版本验收（2026-10-27）

## 来源与合并策略

本轮在独立 worktree `/workspace/story-integration`、新分支 `integration/story-20261027` 工作。main 与原 PR 分支均未修改，没有合并远端 PR。

| 来源 | 冻结提交 | 依赖与审查结果 |
| --- | --- | --- |
| main | `1a6895f3c69c932b131554e380de6b5cd4d54a41` | 原有小说核心 |
| #23 | `9166ffc02529dc9f9357243086706805f7f1b47b` | 已集成 #19 时间线/回收站、#20 一致性审阅、#21 AI 规划；保留其冲突矩阵和全部实现 |
| #24 | `5fc17182858be0df98351e7fa906f121cf469c04` | 基于 #23，草稿连接/恢复竞态、SQLite 启动原子性 |
| #25 | `45b40769deec00c39726b81875a7b18376cc40c0` | 基于 #24，IndexedDB 同步打开失败恢复与迟到连接释放 |
| #26 | `12bb9f29f355d9bc401c0589724c087331300522` | 独立基于 #24，AI 写作提示词模板 |

从 #25 建立新分支，再以普通双父 merge 合入 #26，得到 `19008d264b86606fb7f89a4990e95b9b6c1ad1a2`。共同基线 #24 已包含 #23，故本次无需重复重放 #19–#24 的既有功能。Git 自动合并无冲突；逐项确认 #25 的草稿 store 和安全专项 CI、#26 的模板组件与 AI 写作回归都存在。四个冻结 head 的 `git merge-base --is-ancestor` 均通过，保留来源父链。基础 SQL 0001–0006、planning_001–002 不变，没有新迁移或依赖。

后续仅追加工作区缓存隔离：将 TypeScript incremental 缓存从共享 node_modules 移到本 worktree 的 work/tsbuild（cherry-pick 共享线纯配置提交 `0c1a613`，本线提交 `5a4dc64`），以及 Vite cacheDir 指向 work/vite-cache。多 worktree 可以复用只读依赖而不互相重建运行中的缓存。待首轮浏览器退出后才修改配置，避免主动触发活跃草稿页 reload；没有引入共享线其它业务代码。缓存调整后的基础检查和 Mock E2E 另行执行。

## 架构复核

现有小说业务使用 React feature 目录、共享 TypeScript contracts 与 Express 模块 router/store。SQLite 仅由 composition root 打开；基础与规划迁移位于同一启动事务。小说、人物/世界观、规划/时间线继续使用原 store 与版本/generation 校验。AI 写作、规划生成、只读审阅共用 Provider、模型目录、预算及并发入口；提示词模板仅显式填入可编辑要求，不自动发送或写正文。

不创建平行小说存储或第二套 AI 预算。既有集成/API 测试覆盖生成世界观→引用审阅→删除使确认失效→原 ID 恢复，以及三个 AI 用例共用预算；本轮直接重跑这些真实行为测试，不增加复制实现的测试。

## 本地自动化结果

首轮命令在合并提交 `19008d2` 执行，随后缓存隔离变更另列，不能把首轮完整回归称为最终配置完整回归。测试使用临时 SQLite、临时备份、隔离浏览器与 Mock AI。没有读取 `.env` 或既有 `data`；生产构建配置禁止加载 env 文件。沿用已安装的锁文件依赖，通过 symlink 使用 node_modules，未声称本轮重新运行 npm ci。

| 检查 | 结果 |
| --- | --- |
| lint | 通过 |
| 完整 typecheck（前端、服务端、E2E、单元） | 通过 |
| build | 通过 |
| 全部单元/API | 233/233，失败/取消/跳过均 0 |
| SQLite 迁移、回收站、备份、草稿数据安全专项 | 86/86，失败/取消/跳过均 0 |
| Chromium 浏览器完整单进程回归（19008d2） | 未通过：93 passed、28 did not run；单项断言失败 0；2 项套件级错误（900s 执行超时、teardown 超时），exit 1 |
| 缓存隔离配置后的 lint / 完整 typecheck / build | 全部通过 |
| 缓存隔离配置后的 AI 规划全栈 Mock E2E | 17/17，unexpected/flaky/skipped 均 0，约 63 秒，exit 0 |

数据专项为全部单元/API 的子集，不相加。未放宽断言、超时或删除用例。原命令的位置过滤词 `integration` 也匹配本 worktree 绝对路径，因此浏览器实际启动完整 121 项回归；按实际覆盖记录结果，不称为仅专项。Chromium 使用 `/usr/bin/chromium`，1 worker；浏览器服务由既有 runner 随机端口与临时目录启动并清理。该单进程完整运行触及原 900 秒全局预算，不能称为完整通过；93 项已通过包含全部 AI 写作（17 项，含新增桌面/移动模板）、IndexedDB 打开恢复/草稿、人物/世界观、规划、集成与前两个时间线用例。未执行 28 项没有标为成功或跳过验证。完整覆盖采用已有 CI 三片独立 runner，不放宽预算；结果与 SHA 另列于 Draft PR 描述。

本地日志 `/tmp/story-{lint,types,build,tests,safety,e2e}.log`、`/tmp/story-{lint,types,build,mock}-final.log` 与 work/e2e-results 仅为当前工作区临时证据；[新 Draft PR #27](https://github.com/shawnhhh/storyforge/pull/27) 的当前提交 CI 应另外核对，不能以来源 PR 成功冒充当前结果。初始合并 SHA `19008d2` 的 [PR CI 40434560276](https://github.com/shawnhhh/storyforge/actions/runs/40434560276) 在记录时仍未全部完成；已核对 Chromium 第二片 31 项、第三片 38 项通过，第一片与其它作业最终结论由 PR 描述补充。它不替代后续仅缓存/文档提交的新 head CI。

## 来源 CI 与验收边界

2026-10-27 读取的 #23–#26 最新 head CI 全部 completed/success，各 9/9 jobs：[#23](https://github.com/shawnhhh/storyforge/actions/runs/40297316977)、[#24](https://github.com/shawnhhh/storyforge/actions/runs/40335383307)、[#25](https://github.com/shawnhhh/storyforge/actions/runs/40343061680)、[#26](https://github.com/shawnhhh/storyforge/actions/runs/40344002162)。这是来源证据，当前集成 SHA 的 CI 链接在新 PR 描述登记。

原生 Safari/iPhone、真实中文 IME、系统后台回收与真实付费模型质量仍待人工；历史 WebKit 整页关闭根因未定。本地 Chromium 成功不代表 Firefox/WebKit 或真机成功。继续保持 Draft，不自动合并。代码回滚不能替代数据库降级；v5/v6 库不能交给旧 v4 二进制，先保留一致性现场并在副本验证恢复方案。
