# D 阶段 Music3 WAV 完整性修复验收

## 基线与云端核实

独立分支 `fix/d-music3-wave-integrity-20261028` 基于 #40 `924398015404ac22a6ca3a2d4ff43e1c865368c8`，不修改 #40 原分支。实际组合代码包含 #35→#36→#37→#38→#39→#40。

2026-10-28 通过 GitHub Actions API 逐 Job 核实 #40 的完整结果，无失败日志待修复：

|工作流|结果|证据|
|---|---|---|
|完整回归|9/9 success，含 Chromium/Firefox 分片和 macOS Chrome/WebKit|[40666345237](https://github.com/shawnhhh/storyforge/actions/runs/40666345237)|
|Music3 官方协议 fixture|4/4 success，Chromium、Firefox、macOS Chrome/WebKit|[40666345246](https://github.com/shawnhhh/storyforge/actions/runs/40666345246)|
|费用确认专项|2/2 success，macOS Chrome/WebKit 各重复十次并回归|[40666345235](https://github.com/shawnhhh/storyforge/actions/runs/40666345235)|

以上是修复前的冻结 SHA 验收，不能替代本修复 SHA 的 CI。本修复准确 SHA、CI 链接和最终状态记录在独立 Draft PR 正文。

## 问题与修复

原 Music3 导入仅检查接收内容的 SHA-256 和 WAV 魔数。上游可以正常结束 HTTP 响应，却只返回带有合法 RIFF/WAVE 头的截断文件：接收内容的哈希仍然一致，原代码会发布不可播放的音频并结算预算。

现在在进入 B 的媒体上传/CAS 之前，验证 RIFF 声明长度与实际文件长度一致、所有 chunk 长度和奇数 padding 合法、存在唯一非空 data chunk、存在唯一 PCM16 fmt chunk、采样率/声道/blockAlign/byteRate 一致、音频数据包含完整采样帧。与官方文档的 16-bit PCM 协议对应；其他编码明确拒绝，不宣称支持任意 WAV 变体。允许正常扩展元数据 chunk，但同步检查最多 4096 个 chunk，防止恶意 tiny-chunk 文件长时间阻塞服务端。检查只读取固定大小头部，跳过音频 payload，不把大媒体读入内存。

将手工读写循环替换为带 AbortSignal 的 stream pipeline，统一处理源读取失败、目标写入失败、背压与取消。文件流使用 `flush:true`；等管道完成并关闭文件、刷新内容之后，再做结构/哈希校验及媒体发布。这不等于已经验收硬件断电或目录元数据的持久性。

失败继续沿用 A/C：持久失败、脱敏错误、不自动重发非幂等请求、预留保留但不结算；相同幂等键仍指向原任务。临时文件清理；不创建素材引用、不覆盖歌词。没有数据库迁移、价格变更、费用断言删除或质量门槛放宽。

## 自动验收

- Music3 合约 8/8：保留原 5 项请求/重启/取消/预算/备份断言，新增结构边界检查、截断响应完整任务链、读取中断完整任务链。有效 PCM16 单声道及官方 32kHz 双声道格式可导入，普通带 padding 元数据可通过；坏长度/编码/采样帧/缺 data/过多 chunk 均拒绝。
- 完整单元/API 294 项；lint、typecheck（包含在 build）、生产 build。
- Chromium 官方 HTTP fixture 2 项：成功试听/刷新/下载、截断结果失败后刷新仍不产生素材并保留歌词。
- Chromium 音乐/视频/费用确认/持久任务/媒体/统一备份完整专项 14/14。
- 继承完整九 Job CI 和四平台 Music3 工作流，自动在本修复 SHA 重跑。测试全部使用隔离临时数据库和合成 WAV，没有真实 Key、用户数据、GPU 或付费请求。

## 剩余风险与 E 准备

本修复不解决托管 Music3 文档访问/正式授权/报价未知；自托管真实 GPU 推理、听感及模型遵循程度未验收。结构校验不是音质检测，也不保证硬件故障后文件存在；磁盘配额、极大备份同步验证仍是后续工作。

E 的进入条件为当前修复完整 CI 成功。下一步先冻结官方视频协议来源，逐项核实文生/图生视频请求、异步查询、远端取消/幂等/Webhook、下载域名、有效期、授权与价格；未证实能力明确不支持。实现时继续复用 A 的任务、B 的 CAS、C 的 Vault/预算/SSRF 校验，使用官方协议 Mock fixtures 和虚拟价格。默认关闭真实请求，单镜头优先；本次没有启用视频模型，不把 E 准备记为 E 功能完成。

已只读核查官方 [CLI README](https://github.com/MiniMax-AI/cli/blob/38aba5f26173dd1065b115b221d79c9ddd87c6bb/README.md) 和 [视频 SDK 合约 fixtures](https://github.com/MiniMax-AI/cli/blob/38aba5f26173dd1065b115b221d79c9ddd87c6bb/test/sdk/video.test.ts)，冻结 `38aba5f26173dd1065b115b221d79c9ddd87c6bb`：Hailuo-2.3 V1 和 MiniMax-H3 V2 请求结构不同，不能混用。H3 fixture 显示 `POST /v2/video_generation` 返回 task_id、`GET /v2/query/video_generation/{id}` 返回 task.status/content.url，默认 2K/5 秒/16:9；这只是 E 的官方协议调查依据，不代表本仓库已经实现，也不证明正式地域授权、价格、取消、幂等或 Webhook 支持。

main、#35–#40 原始代码分支保持不变，所有 PR 保持 Draft，不合并。
