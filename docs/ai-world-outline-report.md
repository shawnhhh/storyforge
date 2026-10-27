# AI 世界观与大纲开发及测试报告

日期：2026-10-20。独立 worktree `/workspace/storyforge-ai`，分支 `feat/ai-world-outline-preview-20261020`。保留原 `/workspace/storyforge` 与所有现有数据。

实现、操作流程、复用、并发/预算和预览保护见 [功能说明](ai-world-outline.md)。完成四类单项生成、发送前核对、结果预览编辑、导出与显式确认新增。未修改 main、PR #19、PR #20 或原指定分支，未合并、未启用自动合并。没有新增依赖、数据库迁移或付费 AI 调用。

## 本地验证（严格区分环境与代码）

| 检查 | 结果与计数 |
| --- | --- |
| 依赖安装 | 环境失败：离线缓存缺少 playwright-core 1.64.1/fake-indexeddb，普通网络 proxy:8080 连接失败；保留现有依赖目录 |
| lint | 最终通过；新增焦点恢复首轮因 render 中读取 ref 触发 React lint，已改为 state 并重跑 |
| 前端/后端 typecheck | `tsc -b` 与 `tsc -p server/tsconfig.json` 通过 |
| 完整 typecheck | 未通过：缺少 @playwright/test、fake-indexeddb；引发测试类型声明及后续隐式 any 错误，未标记为通过 |
| Vite 生产打包 | `vite build` 通过，跳过 .env |
| `npm run build` | 未通过：其前置完整 typecheck 受上述依赖缺失阻止，不能以 Vite 单独通过代替 |
| 新增数据安全单元 | 7/7 通过，零跳过；覆盖四类新增、编辑保存、原稿不变、幂等、过期/旧版本/伪造/删除小说、JSON/长度/跨作品引用 |
| 新增 HTTP API | 本地 EPERM 阻止 127.0.0.1 监听，未运行到 HTTP 断言；已写真实 API Mock 用例交由 CI |
| 完整 `npm test` | 执行失败：API 监听 EPERM、草稿测试缺少 fake-indexeddb；保留日志，不声明完整单元/API 通过 |
| 新增与原 Playwright E2E | 运行器在分配临时端口时 EPERM，浏览器未启动；本地通过数为 0，不能标记通过 |

以上 7 项单元包含在新增测试文件中，筛选运行与完整尝试的同一用例不重复累计。API 用例包括预览/确认门禁、共享写作预算、失效请求、截断和无效 JSON、模型错误脱敏、硬超时、取消传播，以及输入/token/费用限额。新增 E2E 6 项（四类型 + 取消/失败/冲突导出 + 主题窄屏），使用真实本地 API 与临时 SQLite、Mock Provider。

完整原始本地日志保存在 work/：`dependency-install.log`、`lint-first-failure.log`、`lint.log`、`typecheck-app.log`、`typecheck-server.log`、`typecheck-full.log`、`build-full.log`、`build-vite.log`、`unit-api.log`、`ai-planning-unit.log`、`ai-planning-api.log`、`ai-planning-e2e.log`。work 被 gitignore 排除，不上传可能混入环境信息的全部原始日志；另提交精简的 [本地验证记录](ai-world-outline-local-validation.txt)。

## CI 验证

Draft PR [#21](https://github.com/shawnhhh/storyforge/pull/21) 已通过 GitHub 连接器创建，保持 Draft。普通 Git 连接 proxy:8080 失败，连接器上传的完整 tree SHA 与本地 staged tree 相同；没有 force push。

首轮 [CI 39391600828](https://github.com/shawnhhh/storyforge/actions/runs/39391600828) 的真实结果：Linux npm ci、lint、完整 typecheck、build、**132/132 单元/API**、3 次崩溃恢复和 41 项写作回归通过；新规划专项三个平台各 1/6 通过、5 项失败。这 5 项是代码问题，不归为环境问题：四类生成已经通过新增/不覆盖断言，但保存关闭后焦点未回到重建的入口；主题控件被全局深色规则覆盖（文字实测 rgb(229,229,234)，预期 rgb(242,242,247)）。后续完整 E2E 被失败步骤阻止，未运行不能计通过。

修复提交 `e7fe42d`：焦点恢复改为等待异步草稿检查结束、入口可用后执行一次；弹窗增加局部样式作用域，确保语义颜色优先级正确。未删除测试、未修改断言、未放宽超时。第二轮 WebKit 已验证焦点修复，专项 5/6 通过；剩余主题项因全局 `:is()` 含类选择器而与局部两类选择器同优先级，继续覆盖文字颜色。补上 `:root` 作用域提高局部规则优先级，保留原精确颜色断言。第二轮日志 work/ci-118593993825.log 保留。三份首轮 job 原始日志已保留到 work/ci-118524195512.log、ci-118524195840.log、ci-118524195920.log；首轮截图和 trace 保存在该 CI 的 artifacts。修复后的完整检查以 PR 描述中核对过的最终运行结果为准。

工作流自动执行：Linux 执行 npm ci、lint、完整 typecheck、build、单元/API、AI 规划专项及原完整 E2E。macOS Chrome/WebKit 执行新增 AI 规划专项与已有写作回归。最终实际执行结果与链接登记在 PR 描述；未结束、未运行或失败的项目不计为通过。

## 剩余风险与建议

- 本地环境无法完成依赖和端口测试，须以远端同一提交的 CI 结果确认 HTTP、真实浏览器行为；不能由 7 项纯单元推断全链路通过。
- 真实 Mac Safari/iPhone 中文输入、modal 焦点、下载与主题需人工验收。先用独立虚构小说目录，四类生成均检查确认前无写入、确认后只追加，其他窗口修改必须拒绝保存。
- 人物完整设定落到“备注”，结构化字段与关联由现有资料编辑器进一步整理；当前一次只生成一项。
- 预览内存有 30 分钟/100 项上限，重启或浏览器崩溃后需重新生成；保存前建议导出。大作品库基线哈希性能尚未专项压测。
- PR #19/#20 仍未合并，后续集成需要重新验证共用路由、规划 UI、Vite/CI 的冲突与 generation/删除保护。
- 自动化仅 Mock AI，未评估真实模型产文质量及供应商实际费用。

保持 Draft，不自动合并。
