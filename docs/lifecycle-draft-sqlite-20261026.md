# WebKit 生命周期、草稿恢复竞态与 SQLite 启动安全排查

## 基线与隔离

2026-10-26 两次读取 PR #23，最新 head 均为 `9166ffc02529dc9f9357243086706805f7f1b47b`。从该提交创建独立分支 `fix/webkit-draft-sqlite-20261026`。阅读 `formal-integration-20261026.md`、草稿恢复中文报告和已有草稿、迁移、备份、崩溃恢复测试后实施修复。

基线最新工作流 [40297316977](https://github.com/shawnhhh/storyforge/actions/runs/40297316977) 已完成，9/9 job success，包含 macOS Chrome/WebKit 完整回归及 WebKit 隔离备份草稿恢复五次重复。矩阵不适用的步骤存在预期 skipped，不将其描述为实际执行。该结果属于基线，不能替代本分支 CI。

测试只使用运行器创建的系统临时 SQLite/备份、隔离浏览器上下文/profile。API 测试使用 Mock Provider；E2E 运行器剥离真实 AI 配置，不加载 `.env`，不调用付费模型。不访问用户 data 或真实备份。初次 Git 访问需启用执行环境网络权限；依赖安装默认缓存不可写，改用 `/workspace/.npm-cache` 后 `npm ci` 成功，没有更改依赖/锁文件。

## 已复现的问题与最小修复

| 问题 | 修复前证据 | 修复及回归 |
|---|---|---|
| IndexedDB 被浏览器异常关闭后仍缓存失效连接 | fake-indexeddb 的真实 `forceCloseDatabase` 触发 close，禁用同步日志后重新加载返回“浏览器禁止读取本机草稿” | 监听连接 close，使下次操作重新打开；等待实际 close 事件而非固定延时。断言仅 IndexedDB 可用时重新读取、写入并显示保护成功；读取事务补充 abort 拒绝处理 |
| 异步读取在用户恢复并成功保存之后回调，重新弹出已处理草稿 | 拦截真实 getAll 的成功回调；恢复、保存并清理源后释放回调，原实现 candidates 又出现旧记录 | load 使用递增序号，恢复/成功丢弃使在途读取失效，旧结果/错误不能覆盖新状态。断言 candidates 为空、不阻断编辑、两处存储均无已保存草稿 |
| 规划模块迁移拒绝时，基础迁移已提交 | 临时 v2 库分别包含未来 planning/003 历史、冲突 planning_records 表；启动失败后原 schema 增加 v3–v6 对象 | 启动以一个 BEGIN IMMEDIATE 包含基础与规划迁移；嵌套迁移使用 savepoint，保留独立调用的事务语义。两种失败均连续重开两次，断言原 schema、迁移历史、小说导出和冲突记录不变，integrity_check=ok、foreign_key_check 为空 |

新增浏览器回归：禁用 localStorage、令章节 PUT 失败、等待 IndexedDB 保护成功后关闭标签，在同一隔离上下文新开页面。断言恢复前编辑锁定、数据库完整 DTO 不变；点击明确恢复后正文一致、数据库版本仅增加一次、保护草稿清空、新页面无 pageerror。

这里验证的是连接异常关闭与标签生命周期边界，不把它等同于已解释历史 WebKit 整页关闭。没有证据支持修改浏览器关闭逻辑或增加宽松重试，故保留现有页面 close/crash/disconnect 失败附件、单 worker、45 秒单项、7 秒断言及 900 秒全局预算。

## 验证

环境：Linux，Node 24.19.0，系统 `/usr/bin/chromium`。以下为本分支代码的实际执行结果；专项与完整测试重叠，不相加为独立用例总数。

| 命令/范围 | 结果 |
|---|---|
| `npm ci --cache /workspace/.npm-cache` | 通过 |
| `npm run lint` / `npm run typecheck` / `npm run build` | 通过 |
| `npm test` | 231/231，通过，零失败/取消/跳过 |
| 原有 CI 数据安全专项命令（trash、timeline、planning migrations、restore crash、draft protection、planning recovery） | 84/84，通过，零失败/取消/跳过 |
| 草稿保护 + 规划迁移专项 | 27/27，通过 |
| `E2E_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- --project=chromium draft-recovery` | 13/13，通过 |
| 新增关闭标签回归最终断言复跑 | 1/1，通过（含新页面 pageerror 断言） |
| `npm run test:e2e -- --mock-planning --project=chromium`（同系统 Chromium） | 17/17，通过，零失败/跳过 |
| 本机 WebKit | 未执行：官方下载域名被网络策略以 403 Domain forbidden 拒绝；未绕过代理/策略 |
| `git diff --check` | 通过 |

修复前失败日志在本次云工作区 `/tmp/storyforge-debug.log`（迁移）、`/tmp/storyforge-draft-before.log`（异常关闭）和 `/tmp/storyforge-race-before.log`（延迟恢复）。修复后日志为 `/tmp/storyforge-tests.log`、`/tmp/storyforge-safety.log`、`/tmp/storyforge-target-final.log`、`/tmp/storyforge-e2e.log`、`/tmp/storyforge-tab-final.log`、`/tmp/storyforge-mock.log`。浏览器运行器在 `work/e2e-results/` 保留分次服务日志，失败时保留 trace/截图。上述本地路径不是永久托管证据；远端结果以 Draft PR 当前 SHA 的 CI 为准。

## 人工确认与数据边界

只提交新分支和独立 Draft PR。main、#19–#23 原分支不写入，不合并、不启用自动合并。PR 以 #23 分支为比较基线，仅展示本轮增量；若后续改变集成目标，须先复核 #23 的最终 head 及差异。

没有新 SQL 迁移、schema 版本变化、数据清理或用户数据替换。启动失败回滚只撤销本次未提交迁移，不是降级数据库；WAL 模式初始化不保证失败前后数据库文件字节完全相同，断言的是逻辑 schema 与数据完整保留。备份/恢复算法沿用现有实现，相关崩溃、回滚和回收站回归均纳入专项。

仍须人工验收原生 Safari/iPhone、真实中文 IME、系统后台回收和大正文；本地没有 WebKit 通过声明。历史整页关闭根因继续保留为未决稳定性风险，等待本分支 macOS WebKit CI 和人工确认。不得以旧基线 CI 代替新 head 检查，不进行真实用户数据库演练。
