# G3 Mac测试版候选：完整验收与交付报告

PR **#44**，分支 **integration/g1-unified-beta-20261029**，base main `1a6895f3c69c932b131554e380de6b5cd4d54a41`。最终准确40位SHA、五组CI及逐Job结论固定在[PR #44正文](https://github.com/shawnhhh/storyforge/pull/44)，避免报告提交自引用；安装时复制该SHA，不按浮动分支取版本。保持Draft、未合并；只追加集成分支，不修改main或#35–#43，不强推。

交付为**源码与本地构建运行的隔离体验候选**，需要Git、Node24和完整npm依赖；不是签名/公证的.app或DMG，不是正式商业发布。全部测试仅使用临时数据库、合成作品/媒体和Mock传输，没有真实用户库、Key或付费模型调用。

## 1. 来源与G1门槛

[G1来源/安全矩阵](g1-unified-beta-20261029.md)列出#35–#43准确HEAD，逐一merge-base确认是集成祖先，保留原提交链，无遗漏或重复cherry-pick。初始G1 `2c9872caa3b3625f62274ad86bd9f8887cbdb44c` 完整CI9/9，但Hailuo Chromium/macOS Chrome失败；不能拿来源绿灯替代。

修复门槛 **d1505141572c6b6e375cdade12397b2084976fad** 的23个Job日志均核实包含同一HEAD：

|工作流|门槛历史结果|证据|
|---|---|---|
|StoryForge checks|9/9；四浏览器完整各147/147|[40818009979](https://github.com/shawnhhh/storyforge/actions/runs/40818009979)|
|Composition protocol acceptance|4/4；每平台4项E2E|[40818010160](https://github.com/shawnhhh/storyforge/actions/runs/40818010160)|
|Hailuo protocol acceptance|4/4；每平台2项E2E|[40818010013](https://github.com/shawnhhh/storyforge/actions/runs/40818010013)|
|Music3 protocol acceptance|4/4；每平台2项E2E|[40818009982](https://github.com/shawnhhh/storyforge/actions/runs/40818009982)|
|Studio cost confirmation acceptance|2/2；10次取消/结算及11项工程/任务回归|[40818010128](https://github.com/shawnhhh/storyforge/actions/runs/40818010128)|

GitHub检出临时验证合并提交`1212a7a3907dbe0e8f3f57fe72daee57d9fb5441`，父链含d150514及main；这不是实际合并PR。**最后React身份修复与本报告追加后的HEAD必须重新验收五组CI，最终结论只取PR正文新SHA，不沿用上表。**

## 2. 数量、模块与数据安全

验收集：完整单元/API **320**；集中`test:safety` **73**；迁移/回收站/备份/草稿专项 **86**；beta路径/生命周期 **8**。后三组是320的重叠子集，不相加。Chromium/Firefox完整三分片为57+44+46=**147**；macOS Chrome/WebKit完整各147。另保留AI规划Mock17项及原有重复焦点/恢复用例，不按重复次数冒充独立功能。最终通过数以准确HEAD日志为准，排队/取消/未完成不算通过。

|模块|自动验收范围|未包含|
|---|---|---|
|小说|编辑/自动保存、章节、世界观/人物、规划/时间线、版本/草稿，迁移失败不部分升级|物理IME、原生Safari/iPhone人工体验|
|Music|工程/素材/历史、导入副本与失败零写入、持久Mock任务、Music3合约WAV|真实GPU生成、音质/商业许可|
|Video|工程/分镜、H3文/图协议、隔离下载/截断拒绝/CAS、保存保留输入、本地取消不发布|付费H3生成、真实出口/费用/来源真实性|
|AI|预览确认、版本/引用绑定、Key不进前端、预算/幂等、重启/取消、未知提交不自动重发|真实账号、模型质量和收费|
|联动|章节只读副本、场景/角色/排序、任务/音乐/配音/字幕轨、预览/受限导出|自动导演/TTS、逐帧成片、视频原声提取|
|统一备份|选择性/完整副本、跨库事务/进程中断回滚、重复恢复、缺素材/漏模块拒绝、ID重映射及历史|真实断电、极大用户档案；未选小说模块只保留历史来源|
|存储与任务|WAL/外键/完整性、服务锁、重复导入/提交、CAS长度/哈希、当前/历史引用及GC、预算回滚|完整2GiB实际下载和长期资源峰值|

跨库测试覆盖章节正文、世界观、人物关联、剧情规划及历史，Music/Video工程/素材，以及章节→分镜→任务→视频/音频引用。恢复创建副本，原作保留；漏选依赖模块整批回滚。含联动历史的单工程要求统一备份，避免悬空导入。未派发失败的任务/预算/关联一起回滚；已经远端派发且费用未知时保守保留预留，不承诺取消即退款。

## 3. 真实发现与修复

1. Hailuo保存按版本重建面板，清空模型/提示词，生成按钮禁用；改为稳定工程身份，延迟PUT断言验证输入保留，保留成功发布/截断拒绝/内容不覆盖断言。初始[失败运行40814966066](https://github.com/shawnhhh/storyforge/actions/runs/40814966066)保留。
2. 成功trace进一步发现稳定Hailuo面板与媒体面板兄弟key相同；独立前缀修复，四项联动增加零重复key断言，修复前4失败、修复后4通过。
3. Vite把work内trace HTML当页面修改，保存时reload、表单丢失；本地首轮55过/1失败。截图/trace/服务日志定位后，只排除源码根内work/data/dist监听，新增写HTML期间无导航且草稿保留测试；不关闭trace、不放宽超时。
4. 初次生产依赖审计3项。audit的fixAvailable:false不代表无补丁；查询注册表，更新兼容body-parser2.4.0、qs6.17.1。全量/生产依赖审计均0项（当时已知漏洞库）。保留JSON大小限额，压缩/尾随请求415且无写入，正常JSON可用。
5. 新增安全worktree/profile启动、Mac大小写/Unicode/空格路径保护、链接/特殊文件拒绝、固定SHA/端口、环境隔离、关闭/重启及离线WAL/外键/CAS验证。脚本不删除数据库、媒体或备份。

各修复提交SHA与对应最终CI链接在PR正文。初始云端artifact12871269552文件服务下载被代理403拒绝；已读失败日志及本地等价复现截图/trace，没有声称读取云端图片。所有旧失败记录保留，没有删除用例、跳过错误或放宽原断言。

## 4. 构建与依赖核对

Node24.x，托管macOS日志实际有24.21.0/24.22.1 arm64；本地记录精确版本。SQLite使用Node内置。9项直接运行依赖、19项开发工具；源码候选运行仍需tsx/Vite，必须完整`npm ci`，不能omit=dev安装。锁文件有darwin-arm64的esbuild、Rolldown、Tailwind oxide和Lightning CSS，不复制Linux/Rosetta node_modules。

build生成`work/beta-build-manifest.json`：checkout SHA/父提交、Node/OS/架构、锁文件SHA和7个dist文件长度/哈希。最终CI保存Linux、macOS Chrome、macOS WebKit三份前端bundle/清单artifact；只用于核对，不是独立安装包。最终链接在PR的Actions中。门槛历史artifact为[Linux12873452028](https://github.com/shawnhhh/storyforge/actions/runs/40818009979/artifacts/12873452028)、[macOS Chrome12873581346](https://github.com/shawnhhh/storyforge/actions/runs/40818009979/artifacts/12873581346)、[WebKit12872659502](https://github.com/shawnhhh/storyforge/actions/runs/40818009979/artifacts/12872659502)，不能替代新HEAD产物。云端ZIP受下载策略限制时，只声明核对元数据/生成日志；本地静态资源访问及生产预览生命周期已测试。

未发现顶层LICENSE/NOTICE。正式分发前应确认仓库许可、第三方NOTICE、FFmpeg构建许可/编码器及模型/素材授权；源码体验不代表商业再分发许可。本轮不附带模型权重或第三方二进制安装包。

## 5. Mac启动、首次体验与回退

详细保护及原生清单见[G2指南](g2-mac-beta-guide-20261029.md)。在已有仓库运行，SHA从PR复制，CODE/PROFILE使用全新绝对路径：

```bash
CANDIDATE_SHA='替换为PR44最终验收的40位SHA'
CODE="$HOME/StoryForge-Beta/code-candidate"
PROFILE="$HOME/StoryForge-Beta/profile-candidate"
git fetch origin integration/g1-unified-beta-20261029
git worktree add --detach "$CODE" "$CANDIDATE_SHA"
cd "$CODE"
node -p "process.platform + '/' + process.arch + ' ' + process.version"
npm ci
npm run build
node scripts/beta.ts init --profile "$PROFILE"
node scripts/beta.ts check --profile "$PROFILE"
node scripts/beta.ts start --profile "$PROFILE"
```

应为darwin/arm64 v24。打开BETA_READY的127.0.0.1地址，使用独立持久浏览器配置；私密窗口不用于跨关闭草稿恢复。首次空库新建“合成测试作品”：章节输入→自动保存→刷新，再创建免费Mock音乐/视频、分镜副本、多轨预览与可用时短WebM导出。自动化实际启动生产预览、核对静态资源、新建作品、关闭/重启后保留及仅Mock。

关闭前保存或导出未保存草稿，Ctrl+C等待BETA_STOPPED；运行`node scripts/beta.ts verify --profile "$PROFILE"`，检查两库完整性/外键/WAL及CAS长度/哈希。端口、库、媒体和备份隔离，.env/真实Provider开关/Key不继承。

升级采用新SHA→新worktree→新profile→官方统一媒体备份预览后恢复为新副本；旧profile/备份不删。回退停止新服务，回到旧worktree启动旧profile。不把新schema裸库给旧代码，运行中只复制.sqlite主文件不算可靠备份。失败保留现场，不自动指向真实库。

## 6. 未验证设备、性能与费用授权

GitHub托管macos-26-arm64及Playwright WebKit不是原生Safari应用/真实键盘IME/iPhone验收。拼音组合态、焦点/快捷键、耳机/扬声器、睡眠唤醒、前后台及导出需G2人工签字；iPhone未测，不擅自开放局域网。

实时WebM仍为640×360、15fps、30秒/30片段/20MiB，不保证逐帧确定性或零音画偏差；原生Safari录制不支持时应明确禁用。历史CAS保守保留增加磁盘；硬件断电/磁盘满、极大真实档案、多小时播放、解码资源峰值、完整2GiB传输及真实模型输出未验。合成大库测试不能替代这些条件。

|真实AI|已有适配|本轮未证明/需后续授权|
|---|---|---|
|小说OpenAI兼容/DeepSeek|服务端配置、预览/引用/预算；beta空Key关闭|真实账号、地区、实时价格/条款/质量|
|Music3|自托管协议/WAV完整性，默认关闭|托管Music3 API、CUDA GPU运行/音质、商业模型许可和算力成本；不是已验Mac原生GPU模型|
|Hailuo H3|文/首帧图单镜头任务、查询/结果、隔离下载/CAS，默认关闭|付费生成、真实出口/账号/官方单价/内容授权；管理员预算费率不是官方报价，本地取消不保证停止或退款|
|导演/TTS|Mock分段、素材导入与配音轨|真实导演/TTS/克隆音色未接入，声音/素材许可和收费需另批准|

不编造远程幂等、Webhook、取消、价格或模型效果；正式启用前重新核验官方契约/条款/价格，明确单任务/月度预算与确认流程。本轮没有启用。

## 7. 下一阶段优先级

|优先级|任务|验收方向|
|---|---|---|
|P0|真实Mac Safari/IME/音视频/恢复签字，记录系统/芯片/Node/浏览器/准确SHA；确认候选分发许可|先确认原稿/草稿安全；继续Draft等待人工验收|
|P1|确定性的1080p短片服务端渲染|先短片；计划/资源预算/确认，隔离解码、长度/哈希/CAS，失败取消回滚，不覆盖；测帧时间/音画同步|
|P2|多镜头裁剪/拆分/排序、字幕及音乐/配音同步、波形/标记|先本地素材/手动对齐；schema升级、历史与备份兼容，再设计转场/多视频合成|
|P3|长视频分段渲染、检查点/断点恢复|磁盘/内存/时长上限、分段哈希、可取消/恢复队列及事务发布，合成长片测资源峰值|
|P4|真实AI/TTS、正式Mac打包|另行费用/授权批准；签名/公证/更新/回退单独验收，不自动订阅或调用收费服务|

以上为后续方案，不是已实现能力。最终PR五组CI全绿后交付隔离体验候选，保留Draft，停止修改，等待人工验收；不自行合并main。
