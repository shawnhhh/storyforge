# G2 Mac 本地测试：隔离安装、运行和恢复

本指南针对 #44 的精确验收 SHA。云端测试不是原生 Safari、中文输入法、Mac/iPhone 硬件验收。保持 Draft，所有作品使用合成测试内容；本轮没有真实 Key、用户作品或付费模型授权。

## 环境与安装

- macOS Apple Silicon 使用原生 arm64 Node **24.x** 和 npm；`node -p "process.platform + '/' + process.arch + ' ' + process.version"` 应显示 `darwin/arm64 v24…`。Rosetta/x64 结果不能算 arm64 通过。
- 锁文件包含 darwin-arm64 的 esbuild、Rolldown、Tailwind oxide、Lightning CSS 可选包；SQLite 使用 Node 内置 `node:sqlite`，没有跨架构复制数据库驱动。每个新 worktree 执行 `npm ci`，不复制其他架构的 node_modules。
- build生成`work/beta-build-manifest.json`，记录checkout SHA/父提交、Node/OS/架构、锁文件SHA-256和每个dist文件的长度/哈希。完整CI保存Linux及macOS Chrome/WebKit三份构建artifact；仅含前端bundle与依赖清单，不是独立Mac应用或签名安装包，不能代替后端源码和Node运行时。
- 本地 Mock 试听/预览不要求 GPU 或真实 Provider。运行完整 Hailuo Mock/解码验收需要维护中的 FFmpeg（`brew install ffmpeg`）；FFmpeg 不是视频模型，也不使付费 Provider 自动启用。
- 浏览器须允许本机媒体播放；WebM 录制取决于浏览器真实能力。Safari 不支持时应显示禁用说明，不能视作导出通过。

先在已有仓库目录中执行。将 `CANDIDATE_SHA` 替换为 PR #44 最终验收的40位 SHA；`CODE` 和 `PROFILE` 选全新、互为兄弟的绝对路径。真实数据目录保持原处。

```bash
CANDIDATE_SHA='替换为PR44最终验收的40位SHA'
CODE="$HOME/StoryForge-Beta/code-20261029"
PROFILE="$HOME/StoryForge-Beta/profile-20261029"
git fetch origin integration/g1-unified-beta-20261029
git worktree add --detach "$CODE" "$CANDIDATE_SHA"
cd "$CODE"
node -p "process.platform + '/' + process.arch + ' ' + process.version"
npm ci
npm run lint
npm run build
node scripts/beta.ts init --profile "$PROFILE"
node scripts/beta.ts check --profile "$PROFILE"
node scripts/beta.ts start --profile "$PROFILE"
```

`git worktree add --detach` 保持原 checkout/分支不变，目标已存在时 Git 拒绝。候选内还提供 `node scripts/beta.ts worktree --path 新绝对路径 --ref 精确SHA`，供下一份候选安全创建 worktree；同样拒绝覆盖和分支切换。

看到 `BETA_READY http://127.0.0.1:端口` 后，在独立、持久的浏览器测试配置打开该地址。私密窗口仅用于短暂预览，关闭后可能清除草稿，不用于跨关闭恢复验收。API 与 Web 端口随机分配并写入 profile，重启保持相同；前端 IndexedDB/localStorage 属于这个端口对应的浏览器配置，服务端备份不能代替尚未上传的浏览器草稿。

## 启动器实际保护

`scripts/beta.ts` 使用 Node 标准库，不读取 `.env`，启动 API 不传 `--env-file`；Vite beta 模式禁用 envDir。继承环境中的 `STORYFORGE_*`、`VITE_*`、`E2E_*`、`NODE_OPTIONS`、`NODE_PATH` 和旧端口清除后，只注入隔离路径、端口和空 AI Key，保留系统网络/CA环境。真实 Music3/Hailuo 默认关闭，仅 Mock。

- 只允许 linked、detached、干净的精确 SHA worktree；profile 固定到该 worktree 和 SHA。
- init 只接受不存在的新目录，不接管旧库。profile 不得位于任何已登记 worktree 内，也不得与正式 `~/Library/Application Support/StoryForge` 相交。
- profile 下 `data/` 存两份 SQLite/WAL 及 `media/objects|pending|archives`，`backups/` 为独立官方备份目录，`logs/` 可保存人工诊断记录。目录0700、标记0600；不写真实默认备份路径。
- 每次启动扫描 profile：拒绝符号链接、硬链接及特殊文件，最多100000项；检查端口空闲、构建及依赖存在。服务仅监听127.0.0.1，Web使用strictPort，不自动换端口。
- 前台持有两个子进程，Ctrl+C/SIGTERM只关闭本次拥有的进程，等待SQLite/备份关闭，保留全部数据。10秒仍未退出时强制结束并返回失败，必须保留现场、运行校验；这不等于硬件断电验证。
- 这些措施防止误用路径，不是针对同账号恶意并发篡改文件系统的沙箱，也不是签名/公证的Mac安装包。

## 首次体验、关闭与重启

1. 确认小说列表为空，新建“合成测试作品”；创建章节，输入中文，等待自动保存状态，再刷新核对。新增角色、世界观、大纲和剧情时间线。
2. Music/Video 新建测试工程，生成免费 Mock，试听/播放，明确保存后刷新；确认原稿不变。
3. 章节→分镜：先取消预览，再确认副本；编辑角色、场景和镜头，重排并保存；逐镜头预览/确认 Mock 任务，选择结果和合成音乐/配音，预览字幕多轨。
4. 导出计划→取消→重新确认。支持WebM时下载并播放，验证音频可听；主动取消、切后台、坏媒体都不能产生成功链接。边界为30秒/30片段/20MiB、640×360、15fps实时录制。
5. 关闭前等待保存完成，下载仍未保存的草稿；终端Ctrl+C，等待`BETA_STOPPED`，再执行：

```bash
node scripts/beta.ts verify --profile "$PROFILE"
node scripts/beta.ts start --profile "$PROFILE"
```

verify 持有同一服务锁，运行中拒绝校验；只打开此profile两份库，检查完整性、外键、WAL和所有CAS对象长度/SHA-256。它不证明缺失的浏览器草稿已保存。重启后核对小说、Studio、任务、历史、素材及分镜关联；备份和原文件仍在。

## 备份、恢复与回退

- 通过界面创建**含媒体的统一备份**，选择小说/Music/Video及需要的草稿，下载到单独测试备份位置。含CAS/联动的工程使用统一媒体备份；单独小说备份不包含Studio。
- 在另一份新profile里恢复为新副本：先预览，核对模块，再确认；检查原作保留、ID重映射、音视频可播放、历史可恢复。漏选被依赖模块应整批回滚。重复同包恢复应拒绝重复创建。
- 恢复失败时保留包、profile和日志，不手工替换数据库。正式UI的恢复前安全快照仍保留；修复后从新预览重试。测试期间只使用合成包。
- 更换候选：新SHA→新detached worktree→新profile→官方统一备份恢复。旧候选、旧profile和备份全部保留。回退只需停止新服务，回到旧worktree启动旧profile；不把新schema数据库复制给旧代码，不覆盖真实库。
- 需要离线文件级留档时先正常关闭两服务，完整保留profile（包括WAL、媒体和备份）；运行中的SQLite不能用只复制主`.sqlite`文件的方式备份。

## 原生设备人工签字清单（待验）

记录系统版本、芯片、Node架构、Safari版本、精确SHA、profile、Web端口及截图。每项写通过/失败/未测，不用Mock证明真实模型效果。

|项目|原生Mac Safari人工步骤|云端自动化能证明的范围|
|---|---|---|
|中文IME|拼音/双拼候选选择、组合态空格/回车、连续标点、长文、撤销重做；章节/角色/规划表单都测|合成composition事件和Playwright编辑行为；不是真实输入法|
|焦点/自动保存|编辑时切侧栏、全屏/焦点模式、章节切换、保存失败草稿、重启和多窗口版本冲突|现有焦点/草稿/冲突/崩溃恢复E2E|
|分镜|章节预览取消/确认、角色/场景、重排、草稿刷新恢复、任务结果关联|Mock协议与结构引用校验|
|音乐|用户手势后播放/暂停、拖动、音量、短音频末尾、耳机切换|合成媒体解码和播放状态；不证明实际扬声器音质|
|视频|预览、字幕、配音同步、取消导出、前后台、下载后播放器解码；不支持格式时明确禁用|受控短片WebM/错误路径；不等于原生Safari能力|
|恢复|统一备份、选择性/完整恢复、重复包、缺素材拒绝、重启校验|临时SQLite事务/故障注入及CAS哈希|
|性能/设备|长篇、多素材、长时播放、磁盘临界、睡眠唤醒、真实断电仅在专用实验环境|本轮未验证这些硬件条件|

iPhone 原生设备本轮未验收；127.0.0.1只对运行服务的Mac有效，不为手机测试擅自开放局域网或改写Host/Origin保护。
