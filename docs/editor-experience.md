# 第四阶段：小说编辑器体验优化

基于 `main` 的 `2c82eff59f081f7f18197cc4ccf246209b3cad11` 独立开发，分支为 `feature/phase4-editor-experience`。保留 Tiptap、正文 JSON 和 `contentSchemaVersion: 1`，没有数据库迁移或正文结构变更。

## 使用方式与计数规则

- 页脚实时显示当前章节正文总量，点击字数可查看明细和规则。章节标题不计入。
- 中文：每个汉字计 1，包括 Unicode 扩展汉字。
- 英文（拉丁文字）：每个单词计 1；词内英文/弯撇号与半角连字符不拆词，例如 `don't`、`mother-in-law` 均计 1。组合重音字母不拆词。
- 连续数字计 1 组；其他语言文字按字母逐个计数。
- 空格、换行、中文/英文标点、符号和表情均计 0；换行、段落与硬换行分隔英文词。粗体、斜体等行内格式不拆词。总量为上述中文、英文、数字和其他文字之和。
- 例如 `你好，世界！Hello world, don't stop. 2026 😀` 为 **9**：中文 4、英文 4、数字 1。
- 专注模式隐藏小说库、章节侧栏、格式工具及导出/设置/删除等操作，保留章节导航、保存状态、立即保存和退出按钮。可点击退出或按 Esc；不进入浏览器全屏。
- 章节侧栏按标题或序号搜索；支持上一章、下一章、下拉跳转和当前位置。重复选择当前章不会重建编辑器；切换后当前章滚入侧栏可见区域。
- 切换章节时先完成当前写入及排队修改，成功后才读取目标章节。保存失败、冲突或空标题留在原章节；目标读取失败也保留原编辑器。保存期间暂时锁定编辑与切章，防止误操作。
- 状态明确区分“已保存”“未保存 · 等待自动保存”“保存中…”“保存失败”和“版本冲突 · 未保存”。沿用失败重试、草稿下载、冲突后显式重新加载及离页提醒。

| 操作 | 快捷键 |
| --- | --- |
| 立即保存 | Ctrl/⌘ + Alt/⌥ + Shift + S |
| 切换专注 | Ctrl/⌘ + Alt/⌥ + Shift + F |
| 上一章 / 下一章 | Ctrl/⌘ + Alt/⌥ + Shift + ↑ / ↓ |
| 退出专注 | Esc |

快捷键限定在创作工作区，对话框、输入法组合输入、重复按键和已处理事件不触发。macOS 使用物理 KeyS/KeyF 识别 Option 组合键。Ctrl/⌘+S、F、P、浏览器标签切换等原有绑定保持浏览器行为。组合键也可在章节导航中展开查看。

## 长文处理

Tiptap 不随每个事务重渲染整个编辑器。正文、格式工具和统计分别订阅所需状态；保存队列对相同状态去重。输入只捕获不可变 ProseMirror 文档，在防抖写入时才转成兼容 JSON。统计按顶层块缓存，选区移动完全复用统计，正文变化时只重新统计变化的块并汇总。单个极长段落/列表仍需统计该块；没有承诺无限文档的常量时间操作。

修复了懒加载期间干净章节无法切换、Esc 被 ProseMirror 先处理，以及统计订阅以空实例初始化后刷新显示 0 的实际问题。排队写入还清理被替换的计时器，避免遗留定时任务。

## 2026-10-15 验证记录

环境：Node 24.19.0、Linux、系统 Chromium。所有数据库在测试独立临时目录中创建，浏览器测试由现有 `tests/e2e/run.ts` 显式覆盖数据与备份目录；未读取、删除或覆盖真实小说数据库。

| 检查 | 结果 |
| --- | --- |
| `npm run lint` | 通过 |
| `npm run typecheck` | 通过，含前端、服务端、E2E |
| `npm run build` | 通过，含完整类型检查和 Vite 构建 |
| `npm test`，显式临时 `STORYFORGE_BACKUP_DIR` | **34/34 通过**，0 失败/跳过，约 7.1 秒 |
| 首轮完整 Chromium E2E | **8/11 通过**；3 个失败见下表 |
| 修复后仅重跑 3 个失败 E2E | **3/3 通过**，17.5 秒，无自动重试 |
| macOS Safari / Firefox / 实际中文输入法 | 未验证 |

按用户要求，没有在修复后再次执行全量浏览器套件。先前通过的 8 个用例保留首轮结果；最终修改后的完整 11 用例联跑未验证。字数、导航保存、失败保留、原有 CRUD、双窗口冲突、重试和对话框用例首轮已通过。3 个失败用例使用 `--timeout=20000 --global-timeout=100000 --retries=0 --trace=on`，外层 `timeout --signal=TERM --kill-after=10s 120s` 限时。

### 失败原因、修复及定向结果

| 用例/检查 | 原始错误与分类 | 处理与定向结果 |
| --- | --- | --- |
| `backups.spec.ts`：downloads all formats… | 期望“备份中的中文正文 <&> 🌕”，收到空正文。**产品缺陷**：另一页面懒加载编辑器未挂载时，章节跳转被误判为未保存；trace 显示工作区错误与仍停留在“远航” | 没有活动编辑器且无脏数据时允许读取目标章。备份/恢复代码和原测试未修改；完整用例通过 |
| `editor-experience.spec.ts`：focus mode, scoped shortcuts… | Esc 后小说列表仍隐藏。**产品缺陷**：ProseMirror 对 Esc 调用 preventDefault，工作区冒泡处理跳过退出；捕获/冒泡日志证实 | 使用工作区捕获阶段处理自定义快捷键，同时保留对话框/组合输入保护；用例通过 |
| `editor-experience.spec.ts`：long prose… | 首轮 `locator.press: Unknown key: "字"` 为**测试 API 使用错误**。改用 `keyboard.insertText` 后，又出现刷新统计期望 10501、实际 0 的**产品缺陷** | 统计和工具栏只在真实编辑器实例就绪后挂载，避免 useEditorState 空快照等待新事务。10500 字长文输入、保存、DOM/滚动位置及刷新统计验证通过 |
| 初次 E2E 启动 | `listen EPERM: operation not permitted 127.0.0.1`，**云端沙箱网络限制** | 在允许本地网络的执行权限中运行，没有修改产品或测试断言 |
| 首次后端检查的两个 API 进程用例 | `ENOENT ... mkdir '/home/agent/Library/Application Support/StoryForge/Backups'`，**原测试未覆盖备份目录与云端文件权限共同导致**；其余 32 个通过 | 测试进程设置独立临时 `STORYFORGE_BACKUP_DIR`，完整后端检查 34/34 通过；没有修改备份模块或 API 测试 |

原始上下文、诊断 trace 和运行日志保留在本地忽略目录 `work/phase4-validation/`；最终日志含 `backend-final.log`、`e2e-failed-cases-fixed.log`，失败 trace 在 `diagnostic-e2e-failures/`，修复后 trace 在 `fixed-e2e-traces/`。该目录不提交作品、数据库或大型浏览器工件，以上错误摘要和最终结果随本文提交。

## 修改边界与第三阶段潜在冲突

生产代码仅涉及 `src/features/novels/` 下的 `ChapterEditor.tsx`、`Workspace.tsx`、`autosave.ts`、`workspace.css`，以及新增的 `ChapterNavigation.tsx`、`editor-shortcuts.ts`、`editor-statistics.ts`、`word-count.ts`。测试涉及 `server/tests/autosave.test.ts`、新增 `server/tests/editor-experience.test.ts`、新增 `tests/e2e/editor-experience.spec.ts`，原 `tests/e2e/workspace.spec.ts` 只更新保存快捷键。本文为新增文档。

只读检查第三阶段 PR #3 的文件列表后，**实际重叠文件仅 `src/features/novels/Workspace.tsx`**：第三阶段接入资料库入口，第四阶段加入章节导航、专注控制和快捷键。合并时需同时保留双方入口及未保存保护，并核查快捷键仅作用于小说正文工作区。没有读取或引入第三阶段未合并的实现、修改第三阶段分支，或修改人物、世界观、迁移、共享契约、共享 API、备份恢复代码。

已知限制：未保存草稿仍保留在页面内存，强制关闭可能丢失；可下载草稿。未增加磁盘草稿缓存或改变既有保存契约。实际 macOS 快捷键、Safari 和中文输入法仍需人工验收；Chromium 组合事件测试不等于实机输入法验证。

## PR #4 CI 时序修复

原提交 `398cd88` 的 push run [38697593625](https://github.com/shawnhhh/storyforge/actions/runs/38697593625) 为 9/11 通过，两个 `fill()` 均命中正确的正文 div，但日志明确显示 `contenteditable="false"`。同一提交的 pull_request run [38697677241](https://github.com/shawnhhh/storyforge/actions/runs/38697677241) 为 11/11 通过。原 workflow 未上传工件，两次 run 的 artifacts 均为空，无法下载日志所引用的 error-context 文件。

确认为测试的异步等待不足：切章或刷新期间旧正文仍可见，刷新前后字数也可能相同；这些条件不表示章节读取已完成。Tiptap 在工作区 busy 时锁定正文是正常保护行为。受控 GET 请求验证了等待期间 `aria-busy=true`、正文 `contenteditable=false` 且旧字数仍为 9；放行请求后正文恢复可编辑，内容和统计均正确，没有发现持续无法编辑的产品缺陷。

修复只涉及测试与诊断：新增 `expectChapterReady`，依次断言工作区非忙、目标章节标题、`contenteditable=true`、实际可编辑及预期正文；备份流程在切章完成后才输入，字数用例在刷新完成后才输入。角色选择器使用精确名称。字数测试通过控制真实章节请求的完成时机，覆盖加载中的锁定状态与完成后的解锁，不使用固定等待、force、跳过、自动重试或放宽断言。备份恢复、自动保存、中文正文和富文本产品代码均未修改。

修复后两个定向用例 2/2 通过（14.8 秒）；lint、typecheck、build、`git diff --check` 通过。完整本地 E2E 的启动工具调用被中断，未产生完整运行结果，不能把定向结果称为全量通过。最终完整浏览器结果以修复提交的 push / pull_request Actions 检查为准。失败时现在保留 trace、截图和 error-context，并上传独立命名的 Actions artifact（保留 7 天），以便后续准确诊断。
