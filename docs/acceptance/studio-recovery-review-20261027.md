# StoryForge 续验与总集成准备（2026-10-27 09:08:54 UTC）

状态：**尚未完成全部CI验收，尚未创建总集成PR**。macOS Chrome job [122091128584](https://github.com/shawnhhh/storyforge/actions/runs/40475054830/job/122091128584) 与 WebKit job [122091128636](https://github.com/shawnhhh/storyforge/actions/runs/40475054830/job/122091128636) 仍 queued、未分配runner（runner_name为空），不是通过、不是测试超时。最后复核时间为2026-10-27 09:10:05 UTC；自run创建08:39:41 UTC起已超过30分钟。7个Linux成功job未重新运行。

## 提交身份与CI证据
当前代码：2bc1ab986d1ceb20bb19059ed9fdb13829075e8b。
代码树：b0d3a4357fbb3ea86d4ce5646f85f8c31f9b4f7d。
[完整push CI 40475054830](https://github.com/shawnhhh/storyforge/actions/runs/40475054830)，head_sha和当前本地/远端head完全一致。
本轮重新读取7个成功Linux job的checkout日志，逐个确认git实际检出同一完整SHA；核验摘要见 studio-recovery-sha-audit-20261027.json。没有运行或重新排队任何测试。

| 本提交实际CI结果 | 数量 |
|---|---|
| 单元/API | 263 passed、0 failed、0 skipped |
| 数据/迁移/草稿安全专项（单元/API子集） | 86/86 |
| Chromium完整回归 | 138/138（52+42+44） |
| Firefox完整回归 | 138/138（52+42+44） |
| 原失败两用例本地重复测试（上轮） | 10/10，2用例各5次，非10个唯一用例 |
| macOS Chrome | queued，未执行 |
| macOS WebKit | queued，未执行 |
其他专项/压力重复数量保留在既有报告，不与完整套件相加。

## 本轮不依赖macOS的静态审查
1. main仍为1a6895f3c69c932b131554e380de6b5cd4d54a41；#31–#34远端head与此前冻结SHA一致。本地集成工作区干净。
2. git merge-base确认当前main、#31(a4d2408)、#34(f262698)均为当前head祖先。git merge-tree --write-tree main HEAD产生与当前head完全相同的tree，集成到当前main无新增文件冲突。该命令未移动任何分支，也未合并PR。
3. 补丁指纹确认#32的f0cb947→003cb29、e6d4891→e85b825，#33的81b882f→40ddc1d、cd848d1→554352a，四对patch-id各自一致。无需再次cherry-pick。
4. 小说Workspace在dirty/busy/referenceBusy时取消leave-story事件；App回退hash后不卸载编辑器。Music阻止dirty切换；Video取消confirm后保留编辑器与本机草稿。原测试显式等待confirm处理和hash回退，不引入sleep或放宽超时。
5. 工程导入只接受受限格式、大小、素材路径/类型/base64、关联与历史；预览token绑定digest、五分钟有效、一次性确认。事务内再次查重复收据，新ID/名称不覆盖原作。UI在未保存时禁用导入。
6. Studio v2→v3在同一迁移事务内保留五张原表、增加统一恢复收据与草稿收件箱，异常回滚版本号和schema。冻结v2 fixture的媒体/历史/导入收据相等及重开已纳入263项；旧版本拒绝v3。不能将代码revert当作数据库降级。
7. 统一备份固定schema、临时SQLite、正文/外键/工程内容校验，不执行档案提供的SQL或路径。双写锁读取已提交逻辑数据；恢复切换DELETE journal+synchronous FULL、ATTACH单事务、随后恢复WAL；原作保留，失败事务不留半恢复作品/收据。
8. app的Host/Origin/JSON/generation和busy检查先于导入/备份路由；专用大包解析器在默认1MiB解析器之前。受限范围内工程/统一备份不被默认上限误拦截。
9. E2E runner使用mkdtemp、显式数据目录/备份目录和Mock配置，清理仅针对本次临时目录；不加载.env。跟踪文件审查只发现.env.example模板，没有新增work/测试输出/SQLite/日志/ZIP/视频产物。
10. git diff --check只有server/tests/fixtures/studio-v2.sql第8行空白尾随空格提示；不能把该检查说成全通过。它是上轮冻结fixture抽取留下的格式问题，本轮保持已测试代码SHA不变，未为清理空格触发全量CI。

本轮静态审查未发现需要追加生产修复的阻塞问题。这是对现有源码与已完成自动化证据的审查，不扩大为真实设备或任意历史档案全部兼容的证明。

## 总集成PR准备
创建参数已保存为 studio-recovery-draft-pr-request-20261027.json（draft=true、base=main、head=integration/studio-recovery-20261027），当前GitHub不存在同head的open PR。
该JSON是待提交正文，不是已创建PR。正文当前如实写macOS未执行；两个job都成功后先更新其结果，再调用创建工具，勿提前发布。

执行门槛：
- 再读run40475054830，确认head_sha仍为2bc1ab9完整SHA、总共9个job且全部completed/success，两个macOS日志均检出该SHA并核对数量。
- 再读head/main及来源refs。如head或main变化，重新评估树/CI匹配，不能套用本次结论。
- 创建独立Draft后读取GitHub synthetic merge commit/tree，核对与已审查代码树的关系；按现有workflow等待新PR事件完整CI。由创建PR自然触发的验证不是手动重跑成功push作业；不额外rerun旧套件。
- 失败时按失败用例/trace定位；只执行必要专项与受影响回归；不修改来源PR，不合并。
- 最终报告记录代码head、PR测试merge SHA/tree、push与PR事件run链接、各平台准确数量。PR事件尚未触发/完成时必须继续标待验收。
本轮记录与准备文件仅推送独立验收文档分支，提交标记[skip ci]，不会以文档副本冒充已测试代码head。

## 数据安全与尚未验证项
本轮只读源码、Git与CI日志，未接触真实用户数据库、备份、.env或付费模型。所有历史自动化使用隔离临时库与Mock。
真实Mac Safari、iPhone/iPad Safari、系统中文IME、触摸/横竖屏、后台/锁屏、长期离线、多标签页及硬件断电/磁盘满未完成设备验收。
已有边界：统一备份128MiB、单工程64MiB、素材受限；恢复草稿为独立收件箱需手工采用；全局偏好/计数不覆盖本机；SHA-256不是签名或加密。macOS Playwright WebKit成功也不能替代真实Safari验收。

