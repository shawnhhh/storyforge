# PR #7 CI 检查不一致排查

## 失败日志与根因

- [失败的 push 运行](https://github.com/shawnhhh/storyforge/actions/runs/38745400942)：`npm test` 为 74/75；唯一失败是 `server/tests/story-bible.test.ts:68` 的人物 CRUD 测试，`AssertionError [ERR_ASSERTION]: '师父' !== '林月🌕'`。五项 AI 单元/接口测试均通过。
- [成功的 pull_request 运行](https://github.com/shawnhhh/storyforge/actions/runs/38745437854)：单元/接口 75/75、E2E 37/37。
- 人物列表的既有规则是 SQL `ORDER BY created_at,id`。`created_at` 使用毫秒精度 ISO 时间，ID 使用随机 UUID。原测试把“先创建主角”误当作“主角必定是列表第一项”；同一毫秒内创建两个人物时，顺序实际由 UUID 决定。实现返回的数据正确，断言错误地依赖执行速度与随机值。

使用独立临时数据库、同一时间戳，以及逆序插入的固定 UUID，可确定性重现旧断言：先插入“林月🌕”（ID 尾数 2），再插入“师父”（ID 尾数 1），列表为“师父、林月🌕”，旧断言必然失败。无需重试 CI 即可证明该假设不成立。

## 两类事件为何结果不同

push 检出 `f2be4853e88c4238faa7c4a3e8201345a7e57d92`，PR 检出 GitHub 合并引用 `e62b4a564c8617ca61c63d4ddbce4a86f1d52c67`，两者 Git tree 都是 `9ab7172fd1799d648d64cbc622f1745d2f8989fe`，源码内容完全一致。两次均为 Node 24.21.0、npm 11.19.0，并命中同一个 npm 缓存键、执行相同锁文件的 `npm ci`。

两次是独立托管 runner，Ubuntu 镜像构建号不同（push `20261004.327.1`，PR `20261012.334`），执行时序和随机 UUID 不同。PR 中该 CRUD 用例耗时约 112ms，push 中约 10ms。更快的执行更容易遇到毫秒时间戳碰撞，但无需碰撞也不能把整体耗时当作精确的创建间隔证据；确定性复现与排序规则才是根因依据。

失败用例及人物存储逻辑不读取事件环境变量或 AI 配置；工作流无按事件区分的 env/测试条件。各测试的数据库由 `mkdtempSync` 独立创建并清理；这两个 hosted runner 不共享 SQLite 文件，因此不是跨工作流数据库争用。Node 测试运行器的默认并发配置保持不变；不能依赖串行运行或延迟创建来修复时间戳假设。

## 修复与防回归

- 原 CRUD 测试用作用域限定的 Node mock clock 固定 `Date`，每次运行都覆盖同毫秒创建。时钟在测试结束后由运行器恢复，不污染其他用例。
- 用完整人物数组的相等断言验证两个人物及正确的 UUID 次序，保留原有 Unicode、资料字段、关系、世界观关联、持久化、版本冲突、级联删除、正文不变和外键完整性断言。
- 新增确定性排序回归：同毫秒且 UUID 逆序插入、较早创建时间优先于 UUID、更新不改变创建时间或排序、重新打开数据库保持一致。
- 不修改生产排序规则、不增加睡眠、不修改工作流、不跳过测试、不设置自动重试，也不放宽任何超时或断言标准。

## 验证

在独立测试数据及 Mock AI 条件下，lint、typecheck、build 均通过；完整 `npm test` 为 76/76，完整 Playwright E2E 为 37/37；人物测试文件以 4 个并发进程重复 30 次、共 240 项检查全部通过。GitHub 两类事件的检查结果以 PR #7 修复提交为准，另见 [AI 测试报告](ai-writing-test-report.md)。真实小说数据库、现有 `.env` 与真实 AI 服务均不参与这些测试。
