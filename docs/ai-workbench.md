# AI 写作工作台：上下文、模型与预算

本轮基于尚未合并的 PR #7 最新提交 `8d77903`，分支为 `feat/ai-writing-workbench`。后续 Draft PR 的目标是 `feat/ai-writing`，依赖 PR #7；不能据此认为 AI 功能已进入 main。沿用现有 React/Tiptap、Express/SQLite、Provider 接口和自动保存队列，不新增数据库表、迁移或密钥存储。

## 按需管理上下文

在章节编辑器打开「AI 辅助」，展开「按需引用」。目录只包含本小说的人物、世界观、总纲/分卷/章节大纲、剧情线、剧情卡、伏笔和其他已保存章节的名称，不自动发送这些资料正文。

勾选最多 8 项，可搜索名称，选择 1000/3000/6000/12000 字符预算。服务端读取所选记录，按选择顺序均分长度；标题和分隔符同样计入总预算。界面展示每项发送长度、原长度和是否截断，并显示实际将发给模型的全部引用片段。不会发送其他小说内容，已有章节复用现有富文本导出器转为纯文本。

目录和引用预览都是本地请求，不调用 AI。生成时服务端重新读取并核对 SHA-256 指纹；任一选中记录的版本或片段变化会拒绝生成，请点击「刷新引用预览」后核对。删除引用会得到相应错误提示，重新打开窗口可更新目录。引用只存在于本次窗口内，不写入章节或浏览器持久存储。

「附近正文总长度」控制本章节光标附近的片段，可选择 0、1500、3000、9000 字符，预算分给前文约 2/3、后文约 1/3。选文本身最多 6000 字符，不静默裁剪；超长选文要求缩小选择。沿用第一版「快速摘要」选项，它与逐项引用互斥。没有勾选任何资料时仅发送选文、附近正文和写作要求。

长度以 JavaScript 字符串长度（UTF-16 单元）计，切断处避免拆开有效代理对。预算不足时每项只有片段，不能保证包含全部设定或人物关系。复杂设定宜减少引用数量、提高预算并检查预览。

## 模型配置中心

窗口内展开「模型配置中心」选择已注册模型，调整本次生成的创意程度 `temperature`（0–2）、采样范围 `top_p`（0.1–1）和最大输出 tokens（64 至服务端模型上限，最多 4096）。目录显示未配置密钥的模型，选择后不能生成。参数只作用于当前窗口，服务端再次验证；浏览器不能指定任意接口地址、密钥或未注册模型。

默认提供 OpenAI/兼容 API 与 DeepSeek 两个入口，均使用现有非流式 Chat Completions Provider；没有调用真实服务商做兼容性或质量承诺。OpenAI 沿用原有 `STORYFORGE_AI_API_KEY`、`STORYFORGE_AI_MODEL`、`STORYFORGE_AI_BASE_URL`；也可使用优先级更高的 `STORYFORGE_OPENAI_API_KEY`。DeepSeek 使用：

```dotenv
STORYFORGE_DEEPSEEK_API_KEY=
STORYFORGE_DEEPSEEK_MODEL=deepseek-chat
STORYFORGE_DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
```

密钥只放本机服务端环境或已忽略的 `.env`，不使用 `VITE_` 前缀；macOS/Linux 用 `chmod 600 .env` 限制文件权限。配置中心没有密钥输入框。模型接口、密钥及原始服务商错误不会返回前端或记录日志，密钥不进入 SQLite、备份或 Git。

需要多模型时，在本地服务端设置 `STORYFORGE_AI_MODELS_JSON` 为 JSON 数组（最多 12 项，替换默认目录）。例如以下为非敏感配置结构，实际型号和报价需自己核对：

写入 `.env` 时请把 JSON 压成一行，或按环境文件的多行引号语法包裹；不要把真实密钥填入 JSON。

```json
[
  {
    "id": "deepseek-writing",
    "label": "DeepSeek 写作",
    "provider": "deepseek",
    "model": "deepseek-chat",
    "baseUrl": "https://api.deepseek.com/v1",
    "keyEnv": "STORYFORGE_DEEPSEEK_API_KEY",
    "maxOutputTokens": 2048
  },
  {
    "id": "local-writing",
    "label": "本地兼容模型",
    "provider": "compatible",
    "model": "填写本地模型名",
    "baseUrl": "http://127.0.0.1:1234/v1",
    "keyEnv": "STORYFORGE_LOCAL_API_KEY",
    "maxOutputTokens": 1024
  }
]
```

`provider` 支持 `openai`、`deepseek`、`compatible`；`keyEnv` 只允许 `STORYFORGE_AI_API_KEY`、`STORYFORGE_OPENAI_API_KEY`、`STORYFORGE_DEEPSEEK_API_KEY`、`STORYFORGE_LOCAL_API_KEY` 四个服务端变量名，JSON 禁止内联 `apiKey`。远程必须 HTTPS，本机回环地址可以 HTTP，不跟随重定向。本地兼容服务仍要求非空密钥，可使用其接受的本地认证值。修改目录后重启服务。

可选配置 `inputUsdPerMillion` 和 `outputUsdPerMillion` 两个非负数字，须成对提供，单位为美元/百万 tokens。代码不内置可能过期的服务商价格。新增其他协议时可实现 `AiProvider` 并通过模型配置的 provider 标识选择工厂；目前三个入口都使用 OpenAI 兼容协议。

## 成本、请求和取消保护

默认策略可在服务端调整：

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `STORYFORGE_AI_REQUESTS_PER_MINUTE` | 20 | 全部模型共享的滚动一分钟请求限额 |
| `STORYFORGE_AI_SESSION_REQUESTS` | 100 | 当前服务进程的请求总数 |
| `STORYFORGE_AI_SESSION_TOKENS` | 200000 | 当前进程保守预留 tokens 总数 |
| `STORYFORGE_AI_MAX_INPUT_TOKENS` | 64000 | 单次保守输入估算上限 |
| `STORYFORGE_AI_MAX_REQUEST_USD` | 1 | 有配置报价时的单次预估费用上限 |
| `STORYFORGE_AI_SESSION_USD` | 5 | 有配置报价时的进程费用预留上限 |
| `STORYFORGE_AI_TIMEOUT_MS` | 60000 | 服务端超时，100–120000 毫秒 |

沿用最多两个并发 AI 请求。服务端在调用 Provider **之前**验证模型、参数、引用和预算，并原子预留额度；所有浏览器、章节和模型共享一个进程账本，切换模型不能重置限额。估算用完整提示的 UTF-8 字节数加协议余量，再加最大输出 tokens，刻意偏保守，并非精确 tokenizer。

取消、超时、认证失败和重新生成也保留已预留额度，避免通过取消绕过保护；不自动重试付费请求。账本只存数字及请求时间，不存提示、素材、密钥或生成内容，服务重启后重置，不能代替服务商账户的月度账单限制。

未填写报价时美元费用显示未知，只执行 token、并发及请求次数限制。有报价时按配置报价计算预留额，不保证覆盖服务商额外计费、价格变化或隐藏推理用量。取消会中止上游 HTTP 请求，但远端可能已计费；浏览器另设 125 秒等待上限以覆盖服务端最长超时。

## 预览、确认与撤销

生成稿与原文可以并排查看，也可使用「变更概览」。概览以线性算法合并首尾之间的连续变化区间，可能把中间相同部分包含在修改区间内，不是逐词最小 diff。emoji 按码点比较；HTML/脚本始终按文本渲染和插入。

重新生成时保留上一份成功预览，生成中禁止接受；取消或失败后上一稿仍可接受。润色/扩写/改写明确显示替换选区，续写只插入，灵感只供阅读。任何预览、对比、取消、模型和引用操作都不修改正文。

只有点击接受才产生一个单独的 ProseMirror 历史事件，进入原有自动保存队列。浮动提示提供「撤销本次 AI 修改」；只在正文仍等于刚应用结果时有效，后续编辑会移除该入口，避免误撤销其他修改。原编辑器的撤销/重做始终保留。接受事件与前后输入分组隔离；原文快照已变化时拒绝接受，关闭、切章或卸载会取消请求，旧响应不能写入新章节。浮动提示不占编辑区域布局，保留现有滚动稳定性。

## 白天云端与晚上 Mac 回归

本轮仅在云端实现、Mock 和隔离数据库中验证，不连接你的 Mac，不操作真实小说或备份。中文开发报告及测试结果见 [ai-workbench-report.md](ai-workbench-report.md)。晚上可先检查本地未提交修改，再同步后续功能分支；不要为了回归合并 PR #7 或切换 main。

```sh
git status --short
git fetch origin
# 尚无同名本地分支时：
git switch --track origin/feat/ai-writing-workbench
# 若已有该本地分支，使用 git switch feat/ai-writing-workbench 并检查与远端差异。
npm ci
npm run lint
npm run typecheck
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

E2E 启动器清除所有 StoryForge AI/提供商配置的继承值，创建和清理独立数据库、备份目录；Vite 在 E2E 中不读取本地 `.env`，AI API 全部 Mock。不需要真实密钥或付费 API。可用 `npm run test:e2e -- --headed ai-writing.spec.ts` 观察 Mock 界面流程，再在 Safari 手工检查原生对话框、焦点、选区、滚动与中文输入法。云端 Chromium 结果不能替代 Mac/Safari 完整回归。

手工检查编辑器及未配置密钥的流程时，使用独立临时数据和备份目录，并选择未占用端口；例如：

```sh
storyforge_review_dir=$(mktemp -d)
SERVER_PORT=43013 STORYFORGE_DATA_DIR="$storyforge_review_dir/data" \
STORYFORGE_BACKUP_DIR="$storyforge_review_dir/backups" \
STORYFORGE_AI_API_KEY= STORYFORGE_OPENAI_API_KEY= STORYFORGE_DEEPSEEK_API_KEY= \
STORYFORGE_LOCAL_API_KEY= STORYFORGE_AI_MODELS_JSON= npm run dev:all
```

按终端输出的新地址打开隔离工作台，不连接原有小说目录。这种手工模式没有可调用模型，生成和对比流程使用上面的 headed Mock E2E 观察；不要为回归填入真实付费密钥。
