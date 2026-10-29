# E：真实 AI Video Provider 验收报告

## 基线和范围

从 #41 冻结 SHA `3ced43107ecd55b86c3c641f92609521ce1ef366` 创建独立分支 `feat/stage-e-hailuo-video`。Draft PR 的 base 为 #41 原分支，未修改 main 或 #35–#41，也不合并。最终 head SHA 和对应 CI 链接见本 Draft PR 正文（避免提交文档自引用 SHA）。本轮不进入 F。

实现 MiniMax-H3 V2 单镜头文生视频和单张首帧图生视频；其他模型/版本不冒充 H3，也不隐式降级。所有自动化只使用合成媒体、隔离数据库及 Mock 协议传输，无付费 API、真实 Key、GPU 或真实用户数据。

## 官方规范核查（2026-10-28）

以当前官方 [索引](https://platform.minimax.io/docs/llms.txt) 和 [V2 OpenAPI](https://platform.minimax.io/docs/api-reference/video/generation/api/v2-video-generation.json) 为依据，区别于 D 预研时冻结的旧 CLI：

|能力|H3 V2|旧 Hailuo V1|
|---|---|---|
|提交|POST /v2/video_generation，content 数组|POST /v1/video_generation，prompt / first_frame_image|
|查询|GET /v2/query/video_generation/{task_id}，task.status|GET /v1/query/video_generation?task_id=…，Success 等状态|
|结果|task.content.url|file_id 后走官方文件下载流程|
|取消|DELETE /v2/video_generation/{task_id} 仅 queued 可取消；成功/失败任务调用会删除记录|本轮不实现、不推定存在|

[创建任务](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)、[查询](https://platform.minimax.io/docs/api-reference/video-generation-v2-query)、[取消或删除](https://platform.minimax.io/docs/api-reference/video-generation-v2-delete)、[旧文生接口](https://platform.minimax.io/docs/api-reference/video-generation-t2v)、[旧查询](https://platform.minimax.io/docs/api-reference/video-generation-query)。

当前官方 H3 支持 768P/2K、整数4–15秒；Highspeed仅768P，Lite/Max支持480P/768P，Max最短5秒。本轮只开放标准 MiniMax-H3；提示词保守上限2000字符。文生需具体比例，图生 content.image_url + role:first_frame，ratio=adaptive。参考图/音频/视频、尾帧、编辑、重生成、Context-IR留待后续，拒绝已知不支持字段。

V2查询/列表仅保留最近7天任务；不能把列表当成按本地幂等键找回提交的 API。官方没有提供本适配器可验证的幂等键机制。callback_url 存在 challenge 验证及状态推送，但未核实安全签名协议；不配置回调，不接收其结果，仍以鉴权查询为准。官方远程仅 queued 可取消，但查询和DELETE之间可能完成任务，使同一DELETE变成删除成功记录。未发现条件取消机制，因此适配器所有状态只执行本地取消，不调用DELETE，避免误删供应商记录。

## 数据与费用边界

复用持久化 StudioJobs、不可变输入快照、租约、预算预留与完成结算、Key Vault。提交前先落库 dispatching，再发唯一 POST；响应未知保持记录并失败，不自动重发。拿到 task_id 后可重启恢复查询。查询429/5xx/网络异常使用现有有界重试；任务总期限仍为30分钟。提交失败/未知或本地取消的预留保留，不宣称退费。

默认关闭。启用需显式 `STORYFORGE_HAILUO_ENABLE=official`、Vault master、通过 ServerKeyVault 离线保存 `minimax-hailuo` Key，及显式 `STORYFORGE_MEDIA_BUDGET_CONFIG`。没有浏览器 Key 输入或把 Key 存进工程。存在HTTP(S)代理时控制面也安全拒绝，等待审计过的代理传输实现。固定官方控制面域名 api.minimax.io，不接受用户自定义API地址、不跟随重定向；JSON响应上限1MiB。测试fixture注入只存在测试程序。

官方 [价格页](https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise) 显示标准 H3 768P $0.08/秒、2K $0.13/秒，输入素材另有规则。本轮仅文本/一张免费范围内首帧；采用至少130000微美元/秒的统一保守预留，不声称实际账单。拒绝 virtual=true 或固定 billingSeconds 规避时长的 H3 配置。例：5秒保守预留650000微美元；默认任务限额不足会拒绝。运营方需核对地域、实时报价和授权后自行配置足额任务/月预算。价格改变需重新审计。

单镜头区域保存独立提示词输入、时长/分辨率/首帧设置；来源关联为结构化小说ID/章节ID/分镜ID/角色ID数组/素材ID数组，校验字段和数量，要求章节同时声明小说ID，随 settings.sourceLinks 和任务快照保存，不自动读取或覆盖来源实体。不是 F 的自动联动。一般视频保存操作保留扩展 settings，生成仅追加媒体与任务。

## 无供应商哈希时的下载安全

原 SafeMediaDownloader.download 的 expected.bytes/digest 契约完全保留。只导出同一个 DNS 固定传输以复用；没有给原下载器传入伪造远端哈希。

独立 VideoQuarantine：

1. 默认只允许明确的 video-product.cdn.minimax.io / cdn.hailuoai.com HTTPS 域名；复用拒绝内网/IP/用户凭据/非法端口/DNS重绑定的校验及DNS固定TLS传输，不转发API Key。隔离路径为随机UUID，目录0700、文件0600，拒绝链接/非普通文件。此路径拒绝重定向；新增CDN需先审计。
2. 必须提供合法 Content-Length、identity编码、video/mp4，最多2GiB。缺少长度时安全失败，绝不把EOF当作可信完整性信息。
3. 流式落盘、fsync，保留强ETag、URL哈希、长度、偏移和本地分片SHA-256检查点。重启/中断后重新核对磁盘哈希；仅在同一URL身份、同一强ETag、精确206 Content-Range下续传，否则拒绝或安全重下。无强ETag不做字节续传。有限三次下载尝试，不重发生成任务。
4. 完整传输后逐个验证ISO BMFF顶层box边界及ftyp/moov/mdat，拒绝截断；随后FFmpeg完整解码视频流，禁止网络协议、限制线程/单次分配，有任务超时。缺少FFmpeg时失败，不能跳过。
5. 验证后才计算本地SHA-256，带真实字节长度进入MediaStore.start/prepare原哈希复核及CAS。只有队列任务事务完成时创建引用、结算一次。失败/取消不发布；无引用CAS对象由原24小时GC回收。停止期间保留检查点，下次查到同一任务结果后恢复；链接变化安全重下。

该本地哈希只保证接收后内容一致，不等于供应商签名或独立可信原件哈希。HTTP长度、结构和解码验证能拒绝截断/畸形结果，不能证明创作质量、来源真实性或发现所有恰好仍可解码的上游内容更改；报告不把这些当成已解决问题。

代理环境继续继承原下载器的fail-closed规则：未配置安全DNS固定代理时拒绝下载，不绕过代理。故当前受限云环境只能用Mock下载传输验收；真实部署需要经审计的出口。官方CDN实际区域差异、URL有效期、真实模型输出格式及收费未通过付费调用验证。

## 验证和剩余风险

本地 lint、typecheck、build；完整单元/API；H3专项含请求映射、未知提交防重、重启、本地取消保护、续传、错误长度/MIME/重定向/超限/截断、完整解码/CAS及内容不变。浏览器专项含成功发布、截断失败与刷新恢复。四平台Hailuo专项继承Music3矩阵；完整九Job Chromium/Firefox/macOS Chrome/WebKit回归保留，未删除原断言。具体通过数和最终SHA云端状态以PR正文为准，不把D的绿灯算作E结果。

当前来源关联为结构化ID，不自动验证跨模块实体存在性。普通工程备份保留已发布媒体与来源设置；活跃生成恢复依赖原本地SQLite/媒体检查点，不宣称把活跃远程任务迁移到另一台机器。未实测2GiB网络传输、硬件断电/磁盘满或真实模型质量；大媒体通过流式路径，FFmpeg解析第三方媒体仍有资源/解码器安全风险，部署应使用受维护版本并隔离进程资源。macOS WebKit是Playwright引擎，不是Safari原生应用。

E只有本head完整CI及专项全部通过后才可验收；在此之前保持Draft。通过并经用户验收后，才制定F小说→分镜→视频→配乐联动实现。
