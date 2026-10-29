# Music MVP 中文验收报告

## 实现范围

独立分支 `feat/music-mvp-20261027`，通过 `/#music` 或小说页右下音乐入口使用。共享基础设施基于 `1a92484`，不写入原小说功能分支。歌曲创建、项目列表、重命名、歌词与曲风/情绪/BPM/结构保存、历史版本载入后明确保存，全部使用共享 SQLite 项目接口。保存失败保持编辑器草稿；未保存内容阻止切换项目、返回小说及 hash 路由切换，关闭页面有浏览器提示，并可导出当前草稿。

生成使用 MusicPromptAdapter 将业务配置转换为共享 CreativeProvider 提示词；当前只有 Mock，输出两秒合成 WAV。工作台显示持久化任务进度，支持音频导入、原生试听、素材下载及完整项目 JSON 导出（包含历史、任务和素材原始 base64）。UI 复用共享客户端、TaskProgress、AssetPreview 和全局主题变量，覆盖宽屏与390px布局。

## 数据与范围

所有新音乐内容保存到独立 `studio.sqlite`，不修改小说表、既有迁移或小说备份验证。小说备份不包含 studio 数据，应使用音乐页完整项目导出保留音乐项目。MVP 音频导入上限500KB，适合短片段。Mock 仅验证工作流，不会按歌词演唱或合成真实编曲。真实音乐Provider、长音频流式上传、完整音轨编辑和导入恢复尚未实现。

测试只使用临时 SQLite、虚构歌词、隔离浏览器和 Mock AI；不读 `.env`、真实数据库、真实备份或付费接口。原生Safari/iOS/Android音频下载与播放仍需设备验收。

## 最终本机测试记录

- lint、完整 typecheck、build：通过。首次 typecheck 曾受共用 node_modules 增量缓存干扰报旧接口参数错误，已合入共享的 work/tsbuild 隔离并重跑通过。
- 定向单元/API/SQLite安全：10/10，通过；包括7项共享接口/任务/安全用例与3项Music用例。音乐专项验证非法BPM、曲风、情绪、结构不会改变歌词、版本或历史，SQLite integrity_check 与 foreign_key_check 正常。
- 完整单元/API最终串行复跑：243/243通过，零失败/跳过，40.996秒；覆盖所有原小说测试、共享7项和Music3项。大库 baseline p95 46.57ms，低于原250ms预算。首次并发运行240/241通过，1项性能失败（p95 260.30ms）；保留该失败记录，未删测试、放宽预算或增加重试。
- Music Chromium E2E最终：3/3通过，零失败/跳过，10.7秒。覆盖1440px、390px完整流程和版本冲突/hash离开保护；暂停首次真实项目GET，先填名称断言创建仍禁用，响应成功后才能创建，避免generation未初始化竞态。验证保存后重开、历史、真实WAV duration/currentTime播放、音频导入、含原始媒体的完整导出及无横向溢出。首轮0/3因React textarea默认文本进入隐式label导致exact定位失配，截图中歌词实际保留；补明确aria-label后保留全部原断言与超时重跑通过。

临时日志 `/tmp/music-*.log` 为本机证据，远端CI应按最终head SHA单独验收；本报告不以其它PR的成功替代本分支。

最终功能提交 `a3114f2efa2f0775eaa6445cd10a52795ca8cc12`；其后的报告提交仅登记证据。最后一次 lint、完整 typecheck、build 均退出0，build耗时686ms。新建前连接保护、备份边界提示和共享提示词常量均已纳入本轮验证。

本机日志：`/tmp/music-tests-serial.log`、`/tmp/music-targeted-final.log`、`/tmp/music-e2e-final.log`（首轮失败）、`/tmp/music-e2e-retry.log`（最终成功）、`/tmp/music-{lint,types,build}-verified.log`。成功截图作为PNG base64附件保存在 `work/e2e-results/1793066436968-13429/results.json`，已检查390px完整截图。所有测试专项与完整243项有重叠，不累加为独立测试总数。

Draft PR #29 的远端CI应以最新推送head为准；早期fa50362的CI不能替代最终head。Firefox、WebKit与真实设备验收未在本机执行，不把Chromium结果冒充跨引擎通过。

代码验证边界：243项完整单元/API在连接gate、共享提示词和备份提示已修改后运行；随后仅给歌词textarea增加固定 `aria-label="歌词"`。该纯可访问性标签修改后的代码通过全部3项浏览器和最后完整lint/typecheck/build；没有为纯标签变更重复全量243项，不将其描述为修改后再次执行。
