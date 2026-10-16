# StoryForge

原创 IP 创作平台。在 Mac 本地运行，无登录、无云服务；资料和富文本正文由本机 Express 服务保存到 SQLite。当前已实现小说 CRUD、章节管理、Tiptap 自动保存、多浏览器冲突保护、安全备份、事务恢复和 Markdown / TXT / JSON 小说导出，以及第三阶段人物档案、世界观、人物关系和事件时间线。

第二阶段的数据位置、安全机制、自动备份触发条件和 Mac Safari 验收步骤见 [备份、恢复与导出说明](docs/backup-restore-export.md)。

第三阶段人物档案、世界观、关系与时间线的操作、自动保存规则及 Safari 验收步骤见 [人物与世界观工作台](docs/characters-worldbuilding.md)。

第五阶段新增「创作规划」：独立作品大纲、剧情线/卡片、伏笔、多章节关联和本机草稿恢复。使用方法、具名迁移和 Safari 验收见 [大纲与剧情规划说明](docs/plot-planning.md)。

新增统一「创作资料库」，复用人物与世界观编辑器，支持设定关联、章节资料引用、反向查阅和 JSON 导出。操作与数据安全说明见 [创作资料库](docs/creative-knowledge-base.md)。

## 启动与检查

要求 Node 24.x（`.nvmrc`）与 npm。

```sh
npm ci
cp .env.example .env   # 仅首次配置；已有 .env 时不要覆盖
npm run dev:all
```

已有前后端正在运行时无需重复启动，直接访问页面。前端 `http://127.0.0.1:5173`，后端默认 `http://127.0.0.1:3001`；均只绑定 127.0.0.1。前端请求 `/api`，由 Vite 代理到本地服务。若 5173 被占用，Vite 可能选择另一个端口，请查看终端。

```sh
npm run typecheck
npm run lint
npm run build
npm test
npx playwright install chromium   # 首次运行浏览器测试时安装
npm run test:e2e
```

`dev` / `dev:server` 可分别启动；`start:server` 不启用监听重启。`build` 生成前端 dist，不打包独立服务端；`preview` 没有 API 代理。正式桌面打包仍待实现。

## 架构与目录

保持单个 npm 包，按前端、服务端与跨运行时共享代码隔离，未来有独立应用发布需求时再迁移 workspaces。

```text
src/
  main.tsx / App.tsx        浏览器入口与工作台装配
  app/                     后续路由、布局、Provider
  features/novels/
    Workspace.tsx          小说列表、设置、章节排序与导航
    ChapterEditor.tsx      Tiptap、保存状态、草稿导出和冲突处理
    NovelDialog.tsx        原生对话框、焦点管理及小说创建 / 设置
    autosave.ts            700ms 防抖、串行写入、版本传递
    api.ts                 Express HTTP 客户端与错误协议
    workspace.css          macOS 风格三栏界面
  shared/
    editor/extensions.ts   Tiptap StarterKit 配置
    api/client.ts          通用请求基础封装
    styles/tailwind.css    Tailwind 工具类，不启用 Preflight
    ui/                    后续通用 UI
server/
  src/index.ts             服务装配与关闭
  src/app.ts               Express、请求来源校验与错误处理
  src/config/env.ts        端口和数据目录
  src/db/
    database.ts            SQLite 连接与 PRAGMA
    migrate.ts             事务化、有版本的迁移执行器
    migrations/0001_novels.sql  小说与章节表
  src/modules/novels/
    routes.ts              输入验证与路由
    store.ts               CRUD、版本校验、事务与持久化
  tests/                   数据库、自动保存、HTTP 和真实进程重启测试
tests/e2e/                 Chromium 界面回归与临时数据库测试运行器
shared/
  contracts/novels.ts       小说、章节和正文 JSON 契约
  contracts/health.ts       健康检查类型
  domain/ / ports/         后续平台无关规则与适配契约
```

`src/shared` 是前端共享层；根目录 `shared` 是跨运行时共享层，不依赖 React、Node、SQLite 或云 SDK。前端禁止导入 server。当前简单 CRUD 编排与持久化集中在 store，复杂用例出现后再按端口拆分应用服务 / Repository，避免空业务抽象。

原始 App.css、index.css、assets 和 public 文件保留，模板样式不再由入口加载；原始 Vite README 保留在本文末尾。章节编辑器按需加载。

## SQLite 与迁移

默认数据文件 `data/storyforge.sqlite`；`STORYFORGE_DATA_DIR` 可指定其他目录，相对路径以项目根目录为基准。`SERVER_PORT` 配置服务端口；改动后重启前后端。服务端配置不放入 VITE_*。

启动时先开启外键、WAL 和锁等待，再执行迁移。`schema_migrations` 记录结构版本；0001 新增小说与章节，0002 新增人物、世界观和关联表，0003 新增资料关联和章节引用，不删除旧数据、不自动重建同名表、不更新已有正文。迁移事务失败则回滚并停止启动。后续变更新增迁移脚本并注册，禁止修改已应用的脚本。

小说记录标题、简介、UUID、版本及时间。章节记录标题、顺序、Tiptap JSON、`content_schema_version=1`、并发版本及时间。删除小说级联删除章节，界面要求明确确认；排序和删除均在事务中完成。删除操作没有回收站，请谨慎确认。

`data/`、数据库及 WAL/SHM、`.env`、node_modules、dist 均不提交 Git；源码、SQL 迁移、配置示例和 package-lock.json 应提交。备份使用界面中的“手动备份”或自动备份，均调用 SQLite 官方备份 API；禁止直接复制正在使用的数据库文件。测试使用系统临时目录，不向用户数据文件写入测试小说。

## 保存与并发规则

正文和章节标题在修改后约 700ms 自动保存；同一个编辑器最多一个请求在途，后续输入排队，使用上次响应中的新版本写入。界面显示等待保存、保存中、已保存或保存失败；也可立即保存。未保存时暂停切换章节、项目及删除 / 排序，关闭或刷新浏览器会请求确认。

支持 ⌘S / Ctrl+S 立即保存。格式按钮显示当前选区状态，字数随输入和撤销更新；“专注写作”临时收起小说与章节栏，正文在固定窗口内滚动。小说创建 / 设置使用原生对话框，背景不可操作，Escape 可取消并恢复焦点；请求进行中不能取消。编辑器在挂载后初始化，卸载时取消待执行的保存任务，已发出的写入仍由服务端完成，但不会更新已卸载的界面或继续保存排队草稿。

小说聚合版本在设置、正文、章节增删与排序时递增；章节版本在正文或标题保存时递增。服务端用事务和版本比较拒绝旧版本，返回 HTTP 409。其他浏览器改变数据后，点击“刷新本地数据”读取最新内容；页面不会自动替换当前正在编辑的正文。

冲突时保留编辑器草稿，停止自动重试覆盖。先复制正文或“导出未保存草稿”（JSON 下载），再“重新加载”并确认放弃本页未保存修改。没有自动合并，也没有强制覆盖按钮。普通网络错误可重试；若服务已写入但响应丢失，重试可能进入冲突保护，需要重新加载并核对。

其他窗口删除当前章节或小说时，保存返回 404，同样保留草稿并停止重试。确认重新加载后，章节已删除则选择剩余章节或显示空状态；小说已删除则返回小说列表。新建章节直接使用写入响应更新界面，删除成功后立即移除旧编辑器，避免后续读取失败时继续编辑已删除章节。

当前正文请求最大 1MB，超限会显示保存失败，需拆分章节。保存失败不清空编辑器；切勿在未保存时强制关闭页面。界面内的编辑草稿不是正式数据来源。

## Safari 与 Chrome 验证

1. Safari 打开 `http://127.0.0.1:5173`，点击“创建小说”，填写名称与简介并保存。
2. 点击“创建第一章”，编辑章节标题和正文；工具栏支持粗体、斜体、标题、列表、引用及撤销重做。等待右上角“已保存”。
3. 使用章节栏 ＋ 添加章节，↑ / ↓ 调整顺序；“小说设置”修改标题与简介。
4. 同一台 Mac 上在 Chrome 打开同一地址，选择同一本小说即可读取 Safari 保存的章节和正文。若 Chrome 已经打开，待本页无未保存修改后点击“刷新本地数据”。两个浏览器均读取同一个本地服务和 SQLite 文件。
5. 测试冲突：先让两个浏览器打开同一章节；Safari 修改并等待“已保存”，再在尚未刷新的 Chrome 中修改。Chrome 应显示“版本冲突 · 未保存”，不会覆盖 Safari 的数据。导出 Chrome 草稿后重新加载，再核对 Safari 的正文。
6. 测试恢复：确认“已保存”，停止前后端并重新运行 `npm run dev:all`，重新打开页面；小说、章节顺序和正文仍应存在。

## API

- `GET /api/health`
- `GET / POST /api/novels`
- `GET / PATCH / DELETE /api/novels/:id`
- `POST /api/novels/:id/chapters`
- `PUT /api/novels/:id/chapter-order`：version + 全部 chapterIds
- `GET / PUT / DELETE /api/chapters/:id`

更新、删除和排序必须携带版本；删除章节还需 novelVersion。输入错误返回 400，找不到实体返回 404，版本冲突返回 409。正文由服务端使用同版本 Tiptap schema 验证，写入仅接受 JSON，并限制浏览器来源为本机 127.0.0.1。

## 测试与后续

自动化测试覆盖已有数据保留、迁移幂等及失败回滚、小说 / 章节 CRUD、排序、富文本往返、旧版本拒绝、自动保存串行和重试、真实 HTTP 写入与服务进程重启恢复。HTTP 测试仅监听 127.0.0.1 临时端口，需允许本地端口绑定。Safari / Chrome 的实际界面可按上述步骤手动验证。

浏览器回归覆盖小说创建 / 设置 / 删除、章节创建 / 排序 / 删除、富文本自动保存与刷新恢复、双窗口冲突及草稿导出、远端删除后的恢复、网络失败重试、快捷键保存和对话框焦点。`test:e2e` 自动分配本机端口，启动专用前后端，强制使用系统临时目录作为 `STORYFORGE_DATA_DIR`，结束后关闭进程并清理该目录；不会读取 `.env` 中的数据目录或复用已有服务。失败报告位于被 Git 忽略的 `work/e2e-results/`。可用 `E2E_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` 选择云环境预装浏览器。GitHub Actions 在 Node 24 下运行 lint、类型检查 / 构建、服务端测试和 Chromium 测试。Safari 的实际 Mac 界面仍需手动验证。

下一步可实现小说导入与回收站，再扩展角色与世界观。Mac / Windows 后续选择桌面容器并使用用户应用数据目录；iOS / Android 需要原生存储适配，不能直接运行 Node 服务。CloudBase 未来作为独立同步适配器，实施前设计同步队列、删除标记和冲突规则；当前不引入云 SDK 或账号。

---

## 原始 Vite 模板说明（保留）

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
