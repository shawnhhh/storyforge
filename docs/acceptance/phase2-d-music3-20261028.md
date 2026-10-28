# D 阶段：Music3 官方自托管协议适配验收

## 冻结组合基线

#35→#36→#37→#38→#39 是实际祖先链，本分支从 #39 `b165dc514692001550ea6ad413b3e5d9fac1f04b` 派生。已通过GitHub API核实 #39 完整CI [40654172673](https://github.com/shawnhhh/storyforge/actions/runs/40654172673) 9/9 success，费用专项40654172970两项macOS成功。没有修改main或#35–#39分支/PR，没有合并。

## 官方资料调查及适配边界

官方来源：[MiniMax Music3 README](https://github.com/MiniMax-AI/MiniMax-Music3/blob/efecc2167c68dd6b1ec75fa49f97f23b475513dd/README.md)，固定提交 `efecc2167c68dd6b1ec75fa49f97f23b475513dd`。不是第三方网页抓取或非官方Suno接口。

|项目|官方自托管|官方托管 Music 3.0|
|---|---|---|
|协议|SGLang-Omni POST /v1/audio/speech，非流式|本环境未取得可核验的Music3托管请求规范，未实现|
|请求|model=minimax_ttm；input歌词；instructions描述；response_format=wav；seed=7；max_new_tokens=9000；stream=false|不把Music2.x或其他厂商参数当成Music3官方契约|
|结果|二进制WAV，官方说明32kHz/16bit/stereo，最长5分钟|返回结构、下载域名未证实|
|运行/授权|官方说明需两块CUDA GPU；README链接模型LICENSE；商用授权条款本轮未取得全文，需部署者核验。示例服务没有要求Key；有鉴权部署可用服务端Vault Bearer|正式鉴权、模型访问权限、服务地域、收费单价均未验证|
|费用|没有供应商API费用验收；自有GPU仍有算力成本。使用虚拟价格固定300秒上限预留，不以Mock时长推算真实价格|未确定，不启用付费请求|
|远端能力|未提供远端查询/取消/幂等/Webhook。API明确返回false；只有本地任务轮询/取消|未证实，不编造接口|

2026-10-28 对 `https://platform.minimaxi.com/docs/api-reference/music-generation` 的只读访问被云环境代理403拒绝。没有绕过代理或网络策略。官方GitHub CLI固定树38aba5f26173dd1065b115b221d79c9ddd87c6bb未发现music专用命令，不能用其他模型SDK证明Music3托管可用。因此本PR交付真实自托管协议适配，**不声称已完成官方托管Music3接入/授权/费用调查**。

## 实现与安全

- 保留AsyncCreativeProvider，增加明确能力声明和本地调用凭据。适配器submit只持久登记，不发请求；本地poll启动单次非流式请求，最多两个后台调用。参数映射歌词、曲风、情绪、BPM、歌曲结构到官方input/instructions；纯音乐使用[Instrumental]及无声乐指令，先要求用户明确清空歌词。不保证模型遵循提示；严格时长参数明确拒绝。
- 官方最多5000 token，本适配保守限制映射后4000 UTF-8字节，未冒充精确token计数。没有自动调用官方caption-rewriter或外部LLM。
- 派发标记先写SQLite，再发非幂等HTTP；重启后未收响应的记录标unknown，不自动重发、不虚构远端对账。用户核对服务端后可明确重新提交新任务；失败/未知保留C预算，不自动退款。停止本地请求不能保证远端GPU停止。
- 非流式请求在后台执行，避免A的短poll超时；单请求10分钟上限、A原30分钟任务期限。取消阻止晚到WAV入库。错误按固定代码保存，不泄露上游内容/Key。没有持久进度百分比保证，40%只是本地处理中状态。
- B增量文件导入，流式写WAV、2GiB上限、SHA-256/容器头校验、CAS原子发布、任务→媒体引用关联。歌词/旧素材不覆盖；试听/下载复用大型媒体库，刷新保留。旧JSON遇外置结果要求v2；v2恢复新项目并恢复任务媒体关联，不重放调用凭据或成本账本。
- C报价确认和预算事务复用，报价前先验证Provider启用和参数；billingSeconds支持非精确时长模型按保守上限计费。Key仅Vault读取，浏览器无Key。默认未启用Music3，也没有默认Music3价格；启用服务还必须单独配置预算模型。
- 控制面只允许预配置的 `http://127.0.0.1:PORT/v1/audio/speech`，禁止凭据URL、query、fragment、域名和跳转，不使用用户提供的地址。没有远端结果URL，不绕过C的下载安全：未来托管URL结果必须经过SafeMediaDownloader，不能复用此loopback控制面例外。

## 可运行配置（只用于已核验授权的自有服务）

默认保持关闭。服务端可显式设 `STORYFORGE_MUSIC3_ENABLE=selfhost` 和 `STORYFORGE_MUSIC3_ENDPOINT=http://127.0.0.1:8000/v1/audio/speech`。另在 `STORYFORGE_MEDIA_BUDGET_CONFIG` 的models添加：

```json
{"id":"minimax_ttm","provider":"music3-selfhost","rateMicrosPerSecond":1,"maxSeconds":300,"billingSeconds":300,"maxPrompt":10000,"kinds":["music"],"virtual":true}
```

这是虚拟算力预算示例，不是MiniMax报价。使用既有单任务/月度限额，部署者自行设置。UI显示启用状态、生成Music3按钮、纯音乐控制与远端能力限制；Video不显示Music3选择。

## 自动验收与风险

隔离合约fixtures覆盖官方请求映射、纯音乐、参数拒绝、大WAV导入、任务链接、预算只预留/结算一次、备份副本、重启未知不重发、本地取消晚到音频隔离、上游失败脱敏与预算保留。浏览器真实HTTP fixture模拟官方二进制响应，不使用真实模型或Key。新增四平台CI跑Chromium/Firefox/macOS Chrome/WebKit协议fixture，原九Job完整回归保留；精确SHA、运行链接、测试统计与最终状态记录在本Draft PR。

未验收：真实GPU推理、音质、纯音乐遵循程度、模型token计数、严格时长、真实商用授权、托管API/价格/可用地域、硬件断电/磁盘满。WAV魔数校验不是完整解码，继承B大库同步备份验证与磁盘配额风险。托管接入仍是明确剩余工作，不能把本地Mock合约结果冒充真实AI验收。

E仅准备：待D全量CI和缺口验收稳定后，优先核查官方视频异步任务协议、查询/取消/幂等、结果URL域名与价格，再复用A/B/C；本PR不实现或启用视频付费生成。
